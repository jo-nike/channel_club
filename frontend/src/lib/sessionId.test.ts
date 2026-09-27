import { afterEach, describe, expect, it } from 'vitest'
import { getSessionId } from './sessionId'

describe('getSessionId', () => {
  const realStorage = window.sessionStorage

  afterEach(() => {
    Object.defineProperty(window, 'sessionStorage', { value: realStorage, writable: true })
    realStorage.clear()
  })

  it('keeps one id per tab in sessionStorage', () => {
    const id = getSessionId()

    expect(id).toMatch(/^[0-9a-f]{8}$/)
    expect(sessionStorage.getItem('iptv_session_id')).toBe(id)
    expect(getSessionId()).toBe(id)
  })

  it('falls back to one in-memory id when site storage is blocked', () => {
    const blocked = () => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    }
    Object.defineProperty(window, 'sessionStorage', {
      value: { getItem: blocked, setItem: blocked, removeItem: blocked, clear: blocked },
      writable: true,
    })

    const id = getSessionId()

    expect(id).toMatch(/^[0-9a-f]{8}$/)
    expect(getSessionId()).toBe(id)
  })
})
