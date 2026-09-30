import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * A small, polite reader of Wikidata and English Wikipedia for one-off batches (the position lookup).
 * Wikidata is CC0, so what it returns can be checked in; a Wikipedia sentence is quoted as evidence for
 * a reviewer. Both APIs ask for a User-Agent that says who is calling, and anonymous or generic
 * callers are cut off after a few dozen requests. The repository URL is the contact — no personal
 * address goes out. Requests are spaced out and every response is kept in a JSON file, so a re-run
 * after a fix costs nothing and never hits the API for what it already has.
 */
const WIKIDATA = 'https://www.wikidata.org/w/api.php'
const WIKIPEDIA = 'https://en.wikipedia.org/w/api.php'
const USER_AGENT = 'wnba-data/0.1 (https://github.com/camrynobscura/wnba-data)'
const MIN_GAP_MS = 3000
const RETRY_WAITS_MS = [5000, 15000, 45000]

/** One `wbsearchentities` hit: the item, its English label and the short description. */
export interface SearchHit {
  id: string
  label?: string
  description?: string
}

/** A statement's value as the API sends it: an item reference, a time, or something we don't read. */
export interface Snak {
  datavalue?: { value: unknown }
}

export interface Claim {
  mainsnak: Snak
  qualifiers?: Record<string, Snak[]>
}

/** The parts of an item we read (`wbgetentities` with labels, descriptions and claims). */
export interface Entity {
  id: string
  labels?: { en?: { value: string } }
  descriptions?: { en?: { value: string } }
  claims?: Record<string, Claim[]>
  sitelinks?: { enwiki?: { title: string } }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export class WikimediaClient {
  private readonly cache: Record<string, unknown>
  private lastRequestAt = 0
  /** Requests run one after another, whatever the callers do — the spacing is the point. */
  private queue: Promise<unknown> = Promise.resolve()
  /** Requests that actually went to the API this run (the cache answers the rest). */
  liveRequests = 0

  constructor(private readonly cachePath: string) {
    this.cache = existsSync(cachePath) ? (JSON.parse(readFileSync(cachePath, 'utf8')) as Record<string, unknown>) : {}
  }

  /** Items whose label or alias starts with the text, best matches first. */
  async search(text: string, limit = 7): Promise<SearchHit[]> {
    const data = await this.get<{ search?: SearchHit[] }>(WIKIDATA, {
      action: 'wbsearchentities',
      search: text,
      language: 'en',
      type: 'item',
      limit: String(limit),
    })
    return data.search ?? []
  }

  /** Up to 50 items per request, as the API allows; more are fetched in turn. */
  async entities(ids: string[], props = 'labels|descriptions|claims'): Promise<Record<string, Entity>> {
    const out: Record<string, Entity> = {}
    const unique = [...new Set(ids)]
    for (let i = 0; i < unique.length; i += 50) {
      const batch = unique.slice(i, i + 50)
      const data = await this.get<{ entities?: Record<string, Entity> }>(WIKIDATA, {
        action: 'wbgetentities',
        ids: batch.join('|'),
        props,
        languages: 'en',
      })
      Object.assign(out, data.entities ?? {})
    }
    return out
  }

  /** The English Wikipedia titles of these items, where an article exists. */
  async articleTitles(ids: string[]): Promise<Record<string, string>> {
    const entities = await this.entities(ids, 'sitelinks')
    const out: Record<string, string> = {}
    for (const [id, e] of Object.entries(entities)) {
      const title = e.sitelinks?.enwiki?.title
      if (title) out[id] = title
    }
    return out
  }

  /**
   * An article's lead as plain text (what comes before the first heading) and its full wikitext (for
   * the infobox), in one request. Null for a title with no article.
   */
  async article(title: string): Promise<{ intro: string; wikitext: string } | null> {
    const data = await this.get<{
      query?: {
        pages?: Record<string, { extract?: string; revisions?: { slots?: { main?: { '*'?: string } } }[] }>
      }
    }>(WIKIPEDIA, {
      action: 'query',
      prop: 'extracts|revisions',
      exintro: '1',
      explaintext: '1',
      rvprop: 'content',
      rvslots: 'main',
      redirects: '1',
      titles: title,
    })
    const page = Object.values(data.query?.pages ?? {})[0]
    if (!page) return null
    return { intro: page.extract?.trim() ?? '', wikitext: page.revisions?.[0]?.slots?.main?.['*'] ?? '' }
  }

  private get<T>(api: string, params: Record<string, string>): Promise<T> {
    const url = `${api}?${new URLSearchParams({ ...params, format: 'json' })}`
    const cached = this.cache[url]
    if (cached !== undefined) return Promise.resolve(cached as T)
    const next = this.queue.then(() => this.fetchLive<T>(url))
    this.queue = next.catch(() => undefined)
    return next
  }

  private async fetchLive<T>(url: string): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const wait = this.lastRequestAt + MIN_GAP_MS - Date.now()
      if (wait > 0) await sleep(wait)
      this.lastRequestAt = Date.now()
      this.liveRequests++
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
      if (res.ok) {
        const data = (await res.json()) as T
        this.cache[url] = data
        this.save()
        return data
      }
      const retryWait = RETRY_WAITS_MS[attempt]
      if ((res.status === 429 || res.status >= 500) && retryWait !== undefined) {
        await sleep(retryWait)
        continue
      }
      throw new Error(`${url} → ${res.status} ${res.statusText}`)
    }
  }

  private save(): void {
    mkdirSync(dirname(this.cachePath), { recursive: true })
    writeFileSync(this.cachePath, JSON.stringify(this.cache))
  }
}
