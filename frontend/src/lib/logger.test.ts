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
  })

  describe('log levels output correctly', () => {
    it('should call console.debug for debug level', async () => {
      vi.stubEnv('VITE_LOG_LEVEL', 'debug')
      const { logger } = await import('./logger')

      logger.debug('TestContext', 'test message')

      expect(consoleSpy.debug).toHaveBeenCalled()
    })

    it('should call console.info for info level', async () => {
      vi.stubEnv('VITE_LOG_LEVEL', 'debug')
      const { logger } = await import('./logger')

      logger.info('TestContext', 'test message')

      expect(consoleSpy.info).toHaveBeenCalled()
    })

    it('should call console.warn for warn level', async () => {
      vi.stubEnv('VITE_LOG_LEVEL', 'debug')
      const { logger } = await import('./logger')

      logger.warn('TestContext', 'test message')

      expect(consoleSpy.warn).toHaveBeenCalled()
    })

    it('should call console.error for error level', async () => {
      vi.stubEnv('VITE_LOG_LEVEL', 'debug')
      const { logger } = await import('./logger')

      logger.error('TestContext', 'test message')

      expect(consoleSpy.error).toHaveBeenCalled()
    })
  })

  describe('format includes required fields', () => {
    it('should include timestamp, level, and context in output', async () => {
      vi.stubEnv('VITE_LOG_LEVEL', 'debug')
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
      vi.stubEnv('VITE_LOG_LEVEL', 'debug')
      const { logger } = await import('./logger')
      const extraData = { userId: 123 }

      logger.debug('WebSocket', 'Received message', extraData)

      expect(consoleSpy.debug).toHaveBeenCalled()
      const call = consoleSpy.debug.mock.calls[0]
      expect(call[2]).toBe(extraData)
    })
  })

  describe('level filtering works', () => {
    it('should suppress debug when level is info', async () => {
      vi.stubEnv('VITE_LOG_LEVEL', 'info')
      const { logger } = await import('./logger')

      logger.debug('TestContext', 'should be suppressed')

      expect(consoleSpy.debug).not.toHaveBeenCalled()
    })

    it('should suppress debug and info when level is warn', async () => {
      vi.stubEnv('VITE_LOG_LEVEL', 'warn')
      const { logger } = await import('./logger')

      logger.debug('TestContext', 'should be suppressed')
      logger.info('TestContext', 'should be suppressed')

      expect(consoleSpy.debug).not.toHaveBeenCalled()
      expect(consoleSpy.info).not.toHaveBeenCalled()
    })

    it('should only allow error when level is error', async () => {
      vi.stubEnv('VITE_LOG_LEVEL', 'error')
      const { logger } = await import('./logger')

      logger.debug('TestContext', 'should be suppressed')
      logger.info('TestContext', 'should be suppressed')
      logger.warn('TestContext', 'should be suppressed')
      logger.error('TestContext', 'should be shown')

      expect(consoleSpy.debug).not.toHaveBeenCalled()
      expect(consoleSpy.info).not.toHaveBeenCalled()
      expect(consoleSpy.warn).not.toHaveBeenCalled()
      expect(consoleSpy.error).toHaveBeenCalled()
    })

    it('should allow all levels when level is debug', async () => {
      vi.stubEnv('VITE_LOG_LEVEL', 'debug')
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
  })

  describe('default level behavior', () => {
    it('should default to debug in development mode', async () => {
      vi.stubEnv('DEV', true)
      vi.unstubAllEnvs()
      vi.stubEnv('DEV', 'true')
      // Don't set VITE_LOG_LEVEL to test default
      const { logger } = await import('./logger')

      logger.debug('TestContext', 'should be shown in dev')

      // In dev mode (Vitest runs in dev), debug should be shown
      expect(consoleSpy.debug).toHaveBeenCalled()
    })
  })

  describe('performance - suppressed logs do not format strings', () => {
    it('should not call console method when log is suppressed', async () => {
      vi.stubEnv('VITE_LOG_LEVEL', 'error')
      const { logger } = await import('./logger')

      logger.debug('TestContext', 'message')

      // The console.debug should not be called because the log is suppressed
      expect(consoleSpy.debug).not.toHaveBeenCalled()
    })
  })
})
