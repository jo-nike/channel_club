import { describe, it, expect } from 'vitest'
import { createClientMessageId } from './messageId'

describe('createClientMessageId', () => {
  it('returns 32 lowercase hex characters, within the server limit of 64', () => {
    expect(createClientMessageId()).toMatch(/^[0-9a-f]{32}$/)
  })

  it('returns a different id each time', () => {
    const ids = new Set(Array.from({ length: 50 }, () => createClientMessageId()))
    expect(ids.size).toBe(50)
  })
})
