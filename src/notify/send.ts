import type { IdentityChange } from './watch'

/**
 * Build the alert body from what the refresh found. Plain text (no markdown), so it
 * reads cleanly in both Telegram and Discord. Returns null when there's nothing to
 * report, so the caller can skip sending entirely.
 */
export function formatAlert(
  changes: IdentityChange[],
  unnamedTeamEspnIds: string[],
): string | null {
  if (changes.length === 0 && unnamedTeamEspnIds.length === 0) return null

  const lines: string[] = ['WNBA data refresh — attention needed']

  if (changes.length > 0) {
    lines.push('', 'Featured player changes (update featured.ts):')
    for (const c of changes) {
      const parts = c.fields.map(
        (f) => `${f.field}: ${f.from ?? '—'} → ${f.to ?? '—'}`,
      )
      lines.push(`• ${c.name} (${c.espnId}) — ${parts.join('; ')}`)
    }
  }

  if (unnamedTeamEspnIds.length > 0) {
    lines.push(
      '',
      'New team(s) with no era name (run seed-team-eras):',
      `• ESPN team id(s): ${unnamedTeamEspnIds.join(', ')}`,
    )
  }

  return lines.join('\n')
}

/**
 * Parse an Apprise-style Telegram URL — `tgram://<bot_token>/<chat_id>` — into its
 * parts. The bot token contains a ':' (e.g. 123456:AA...), so we split on '/' by
 * hand rather than using the URL parser, which would misread that colon as a port.
 * Extra path segments (additional chat ids) are ignored; we send to the first.
 */
export function parseTgram(tgramUrl: string): { botToken: string; chatId: string } {
  const rest = tgramUrl.replace(/^tgram:\/\//i, '').replace(/\/+$/, '')
  const [botToken, chatId] = rest.split('/')
  if (!botToken || !chatId) {
    throw new Error(
      'TELEGRAM_URL must look like tgram://<bot_token>/<chat_id> (chat id required)',
    )
  }
  return { botToken, chatId }
}

/** Send a plain-text message via the Telegram Bot API. Throws on a non-2xx. */
export async function sendTelegram(tgramUrl: string, text: string): Promise<void> {
  const { botToken, chatId } = parseTgram(tgramUrl)
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // Telegram caps text at 4096 chars; our alerts are far shorter. No parse_mode
    // → the text is sent literally, so no markdown-escaping pitfalls.
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4096) }),
  })
  if (!res.ok) {
    throw new Error(`Telegram → ${res.status} ${res.statusText}`)
  }
}

/**
 * POST a plain message to a Discord webhook. A webhook URL is all Discord needs —
 * no bot or token. Throws on a non-2xx.
 */
export async function postDiscord(webhookUrl: string, text: string): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: text.slice(0, 2000) }), // Discord caps content at 2000
  })
  if (!res.ok) {
    throw new Error(`Discord webhook → ${res.status} ${res.statusText}`)
  }
}

/**
 * Send an alert via whichever channel is configured, in priority order:
 * TELEGRAM_URL, then DISCORD_WEBHOOK_URL, else nothing. Returns which channel was
 * used so the caller can log it. The caller is responsible for catching errors — a
 * failed notification must never fail the scrape.
 */
export async function sendAlert(text: string): Promise<'telegram' | 'discord' | 'none'> {
  const tgram = process.env.TELEGRAM_URL
  const discord = process.env.DISCORD_WEBHOOK_URL
  if (tgram) {
    await sendTelegram(tgram, text)
    return 'telegram'
  }
  if (discord) {
    await postDiscord(discord, text)
    return 'discord'
  }
  return 'none'
}
