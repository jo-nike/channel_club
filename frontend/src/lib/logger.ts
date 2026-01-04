/**
 * Structured logging utility for the frontend.
 * Provides consistent log formatting with context and level filtering.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const getConfiguredLevel = (): LogLevel => {
  const level = import.meta.env.VITE_LOG_LEVEL as LogLevel | undefined
  if (level && level in LEVELS) return level
  return import.meta.env.DEV ? 'debug' : 'warn'
}

const configuredLevel = getConfiguredLevel()

const shouldLog = (level: LogLevel): boolean => {
  return LEVELS[level] >= LEVELS[configuredLevel]
}

const formatTimestamp = (): string => {
  return new Date().toISOString().substring(11, 23) // HH:mm:ss.SSS
}

const log = (
  level: LogLevel,
  context: string,
  message: string,
  ...data: unknown[]
): void => {
  // Early return for performance - no string formatting if suppressed
  if (!shouldLog(level)) return

  const timestamp = formatTimestamp()
  const prefix = `${timestamp} [${level.toUpperCase()}] [${context}]`

  const consoleFn = console[level]
  if (data.length > 0) {
    consoleFn(prefix, message, ...data)
  } else {
    consoleFn(prefix, message)
  }
}

export const logger = {
  debug: (context: string, message: string, ...data: unknown[]) =>
    log('debug', context, message, ...data),
  info: (context: string, message: string, ...data: unknown[]) =>
    log('info', context, message, ...data),
  warn: (context: string, message: string, ...data: unknown[]) =>
    log('warn', context, message, ...data),
  error: (context: string, message: string, ...data: unknown[]) =>
    log('error', context, message, ...data),
}
