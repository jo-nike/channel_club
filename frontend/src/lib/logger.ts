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

// Everything in development; production builds leave debug out.
const configuredLevel: LogLevel = import.meta.env.DEV ? 'debug' : 'info'

const shouldLog = (level: LogLevel): boolean => {
  return LEVELS[level] >= LEVELS[configuredLevel]
}

const formatTimestamp = (): string => {
  return new Date().toISOString().substring(11, 23) // HH:mm:ss.SSS
}

const credentialKey =
  /^(?:token|access_token|authToken|authorization|password|api[_-]?key|x-plex-token)$/i
const credentialText =
  /([?&](?:token|access_token|authToken|api[_-]?key|x-plex-token)=)[^&\s\\"'<>]*|(Bearer\s+)[^\s"'<>]+/gi

const redactCredentials = (
  value: unknown,
  seen = new WeakSet<object>(),
): unknown => {
  if (typeof value === 'string') {
    const sanitized = value.replace(
      /([?&])([^=&\s]+)=([^&\s\\"'<>]*)/g,
      (match, separator, key) => {
        try {
          return credentialKey.test(decodeURIComponent(key))
            ? `${separator}${key}=[REDACTED]`
            : match
        } catch {
          return match
        }
      },
    )
    return sanitized.replace(
      credentialText,
      (_match, query, bearer) => `${query || bearer}[REDACTED]`,
    )
  }
  if (value && typeof value === 'object') {
    if (seen.has(value)) return '[Circular]'
    seen.add(value)
    if (value instanceof Error) {
      return {
        name: value.name,
        message: redactCredentials(value.message),
        stack: redactCredentials(value.stack),
      }
    }
    if (Array.isArray(value))
      return value.map((item) => redactCredentials(item, seen))
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        credentialKey.test(key) ? '[REDACTED]' : redactCredentials(item, seen),
      ]),
    )
  }
  return value
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
    consoleFn(
      redactCredentials(prefix),
      redactCredentials(message),
      ...data.map((item) => redactCredentials(item)),
    )
  } else {
    consoleFn(redactCredentials(prefix), redactCredentials(message))
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
