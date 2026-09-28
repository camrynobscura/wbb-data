import { describe, it, expect } from 'vitest'
import { isPlayerId } from './playerId'

describe('isPlayerId', () => {
  it('accepts ids up to bigint max', () => {
    expect(isPlayerId('1')).toBe(true)
    expect(isPlayerId('1218')).toBe(true)
    expect(isPlayerId('9223372036854775807')).toBe(true)
  })

  it('rejects ids past bigint max (Postgres would throw → 500)', () => {
    expect(isPlayerId('9223372036854775808')).toBe(false)
    expect(isPlayerId('99999999999999999999')).toBe(false)
  })

  it('rejects anything that is not plain digits', () => {
    for (const id of ['', 'abc', '-1', '1.5', ' 1', '1e3', '0x10']) expect(isPlayerId(id)).toBe(false)
  })
})
