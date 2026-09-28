import { describe, it, expect } from 'vitest'
import { parseTgram, formatAlert } from './send'
import type { IdentityChange } from './watch'

describe('parseTgram', () => {
  it('splits tgram://<bot_token>/<chat_id> (bot token keeps its colon)', () => {
    expect(parseTgram('tgram://123456:AA-bc_DEF/987654321')).toEqual({
      botToken: '123456:AA-bc_DEF',
      chatId: '987654321',
    })
  })

  it('tolerates a trailing slash and extra chat-id segments', () => {
    expect(parseTgram('tgram://123456:AAtoken/111/222/')).toEqual({
      botToken: '123456:AAtoken',
      chatId: '111',
    })
  })

  it('throws when the chat id is missing (just a token)', () => {
    expect(() => parseTgram('tgram://123456:AAtoken')).toThrow(/chat id/i)
  })
})

describe('formatAlert', () => {
  const change: IdentityChange = {
    espnId: '1',
    name: 'Caitlin Clark',
    fields: [{ field: 'team', from: 'Indiana Fever', to: 'Las Vegas Aces' }],
  }

  it('returns null when there is nothing to report', () => {
    expect(formatAlert([], [])).toBeNull()
  })

  it('lists player changes and new teams, with no markdown decorations', () => {
    const msg = formatAlert([change], ['17999'])!
    expect(msg).toContain('Caitlin Clark (1) — team: Indiana Fever → Las Vegas Aces')
    expect(msg).toContain('17999')
    expect(msg).not.toContain('**') // plain text — Telegram shows it as-is
  })

  it('lists a renamed / relocated team as ours → ESPN, and alone is enough to send', () => {
    const msg = formatAlert([], [], [
      { espnId: '18', espnName: 'Houston Comets', espnAbbreviation: 'HOU', eraName: 'Connecticut Sun', eraAbbreviation: 'CON' },
      { espnId: '4', espnName: 'Houston Comets', espnAbbreviation: 'HOU', eraName: null, eraAbbreviation: null },
    ])!
    expect(msg).toContain('team 18: Connecticut Sun (CON) → Houston Comets (HOU)')
    expect(msg).toContain('team 4: no open era → Houston Comets (HOU)')
    expect(formatAlert([], [], [])).toBeNull()
  })
})
