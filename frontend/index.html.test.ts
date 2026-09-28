import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The document CSP allows scripts from 'self' and gstatic only, with no hashes,
// so an inline script in the shell would be blocked once the policy is enforced.
describe('index.html', () => {
  const html = readFileSync(resolve(__dirname, 'index.html'), 'utf8')
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]

  it('has no inline scripts', () => {
    expect(scripts.length).toBeGreaterThan(0)
    for (const [, attributes, body] of scripts) {
      expect(attributes).toMatch(/\ssrc="/)
      expect(body.trim()).toBe('')
    }
  })
})
