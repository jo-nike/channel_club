import { describe, it, expect } from 'vitest'
import { decodeTokenPayload, getTokenSubject } from './jwt'

/** Encode a payload the way a JWT library does: UTF-8, base64url, no padding. */
function base64url(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join('')
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function makeToken(payload: unknown): string {
  return `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url(payload)}.signature`
}

describe('decodeTokenPayload', () => {
  it('decodes a base64url payload that contains - and _', () => {
    // '>>>' and '???' encode to base64 '+' and '/', which base64url writes as '-' and '_'
    const payload = { sub: 'alice', note: '>>>???', exp: 123 }
    const token = makeToken(payload)
    const segment = token.split('.')[1]
    expect(segment).toMatch(/[-_]/)
    expect(segment).not.toMatch(/[+/=]/)

    expect(decodeTokenPayload(token)).toEqual(payload)
  })

  it('decodes a UTF-8 name', () => {
    expect(decodeTokenPayload(makeToken({ sub: 'Zoë 🎉' }))).toEqual({ sub: 'Zoë 🎉' })
  })

  it('returns null for a token without a payload segment', () => {
    expect(decodeTokenPayload('invalid-token')).toBeNull()
  })

  it('returns null when the payload is not base64', () => {
    expect(decodeTokenPayload('header.!!!.signature')).toBeNull()
  })

  it('returns null when the payload is not JSON', () => {
    expect(decodeTokenPayload(`header.${btoa('not json')}.signature`)).toBeNull()
  })

  it('returns null when the payload is not an object', () => {
    expect(decodeTokenPayload(`header.${base64url('alice')}.signature`)).toBeNull()
  })
})

describe('getTokenSubject', () => {
  it('returns the sub claim', () => {
    expect(getTokenSubject(makeToken({ sub: 'jon_doe-1', role: 'viewer' }))).toBe('jon_doe-1')
  })

  it('returns a UTF-8 subject intact', () => {
    expect(getTokenSubject(makeToken({ sub: 'Zoë' }))).toBe('Zoë')
  })

  it('returns null for a malformed token', () => {
    expect(getTokenSubject('not-a-jwt')).toBeNull()
  })

  it('returns null when sub is missing or not a string', () => {
    expect(getTokenSubject(makeToken({ role: 'viewer' }))).toBeNull()
    expect(getTokenSubject(makeToken({ sub: 42 }))).toBeNull()
    expect(getTokenSubject(makeToken({ sub: '' }))).toBeNull()
  })
})
