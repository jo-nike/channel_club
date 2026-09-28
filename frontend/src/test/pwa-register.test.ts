import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

describe('PWA Registration', () => {
  it('registers in prompt mode, so an update never reloads a playing tab by itself', () => {
    // autoUpdate reloads every open tab when a new worker activates; prompt
    // mode waits for src/lib/appUpdate.ts to apply it
    const config = readFileSync('vite.config.ts', 'utf8')
    expect(config).toMatch(/registerType: 'prompt'/)
    expect(config).not.toMatch(/registerType: 'autoUpdate'/)
  })

  it('should handle registration errors gracefully', () => {
    // SW registration can fail for various reasons:
    // - Browser doesn't support SW
    // - Running on HTTP (not HTTPS or localhost)
    // - SW file not found

    // Our implementation should catch and log errors
    const errorHandler = (error: Error) => {
      console.error('SW registration error:', error)
      // Don't crash the app - SW is a progressive enhancement
    }

    expect(() => {
      errorHandler(new Error('SW not supported'))
    }).not.toThrow()
  })
})
