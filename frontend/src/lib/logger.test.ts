import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('logger', () => {
  let consoleSpy: {
    debug: ReturnType<typeof vi.spyOn>
    info: ReturnType<typeof vi.spyOn>
    warn: ReturnType<typeof vi.spyOn>
    error: ReturnType<typeof vi.spyOn>
  }

  beforeEach(() => {
    vi.resetModules()
    consoleSpy = {
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  describe('log levels output correctly', () => {
    it('should call console.debug for debug level', async () => {
      const { logger } = await import('./logger')

      logger.debug('TestContext', 'test message')

      expect(consoleSpy.debug).toHaveBeenCalled()
    })

    it('should call console.info for info level', async () => {
      const { logger } = await import('./logger')

      logger.info('TestContext', 'test message')

      expect(consoleSpy.info).toHaveBeenCalled()
    })

    it('should call console.warn for warn level', async () => {
      const { logger } = await import('./logger')

      logger.warn('TestContext', 'test message')

      expect(consoleSpy.warn).toHaveBeenCalled()
    })

    it('should call console.error for error level', async () => {
      const { logger } = await import('./logger')

      logger.error('TestContext', 'test message')

      expect(consoleSpy.error).toHaveBeenCalled()
    })
  })

  describe('format includes required fields', () => {
    it('should include timestamp, level, and context in output', async () => {
      const { logger } = await import('./logger')

      logger.info('Auth', 'User logged in')

      expect(consoleSpy.info).toHaveBeenCalled()
      const call = consoleSpy.info.mock.calls[0]
      const prefix = call[0] as string

      // Should match format: HH:mm:ss.SSS [LEVEL] [Context]
      expect(prefix).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3} \[INFO\] \[Auth\]$/)
      expect(call[1]).toBe('User logged in')
    })

    it('should include additional data arguments', async () => {
      const { logger } = await import('./logger')
      const extraData = { userId: 123 }

      logger.debug('WebSocket', 'Received message', extraData)

      expect(consoleSpy.debug).toHaveBeenCalled()
      const call = consoleSpy.debug.mock.calls[0]
      expect(call[2]).toEqual(extraData)
    })
  })

  describe('level filtering works', () => {
    it('should allow all levels in development', async () => {
      vi.stubEnv('DEV', true)
      const { logger } = await import('./logger')

      logger.debug('TestContext', 'debug message')
      logger.info('TestContext', 'info message')
      logger.warn('TestContext', 'warn message')
      logger.error('TestContext', 'error message')

      expect(consoleSpy.debug).toHaveBeenCalled()
      expect(consoleSpy.info).toHaveBeenCalled()
      expect(consoleSpy.warn).toHaveBeenCalled()
      expect(consoleSpy.error).toHaveBeenCalled()
    })

    it('should suppress only debug in a production build', async () => {
      vi.stubEnv('DEV', false)
      const { logger } = await import('./logger')

      logger.debug('TestContext', 'should be suppressed')
      logger.info('TestContext', 'info message')

      expect(consoleSpy.debug).not.toHaveBeenCalled()
      expect(consoleSpy.info).toHaveBeenCalled()
    })
  })
})

it.each(['debug', 'info', 'warn', 'error'] as const)(
  'SEC-03 redacts HLS/Cast diagnostics at %s level without mutating callers',
  async (level) => {
    vi.resetModules()
    const spy = vi.spyOn(console, level).mockImplementation(() => {})
    const { logger } = await import('./logger')
    const secret = 'SYNTHETIC_REUSABLE_BEARER_SECRET'
    const url = `https://synthetic/api/ersatztv/stream/1?%74oken=${secret}&channel=1`
    const data = {
      url,
      nested: { authorization: `Bearer ${secret}`, token: secret },
    }
    logger[level]('Cast', `HLS retries exhausted: ${url}`, data, new Error(url))
    const output = JSON.stringify(spy.mock.calls)
    expect(output).not.toContain(secret)
    expect(output).toContain('[REDACTED]')
    expect(output).toContain('channel=1')
    expect(data.nested.token).toBe(secret)
    spy.mockRestore()
    vi.unstubAllEnvs()
  },
)
