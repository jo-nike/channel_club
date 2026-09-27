import { useState, useEffect, useRef, useCallback } from 'react'
import type { UnifiedChannel } from '@/types'

interface UseChannelZapOptions {
  /** The channels to step through, in order (getUnifiedChannels). */
  getChannels: () => UnifiedChannel[]
  /** The channel currently playing. */
  selected: UnifiedChannel | null
  /** The channel watched before this one (tvStore.previousChannelId), for tuneLast. */
  previousId?: string | null
  /** Tunes to a channel once the viewer stops pressing. */
  onTune: (channel: UnifiedChannel) => void
  /** How long after the last step to tune. */
  delayMs?: number
  /** How long after the last digit to commit a typed channel number. */
  entryDelayMs?: number
}

export interface ChannelZap {
  /** The channel the viewer has stepped to but not tuned yet, or null. */
  pending: UnifiedChannel | null
  /** Steps one channel up (+1, next higher number) or down (-1), wrapping. */
  step: (dir: 1 | -1) => void
  /** Tunes straight back to the previous channel, dropping any step in progress. */
  tuneLast: () => void
  /** The digits of a channel number being typed, or null. */
  entry: string | null
  /** A number just entered that no channel has, shown for a moment, or null. */
  missing: string | null
  /** Adds a digit ('0'-'9') to the number being typed. */
  digit: (digit: string) => void
  /** Commits the number being typed now (Enter); false when none is. */
  commitDigits: () => boolean
}

// Channels run 0-36; three digits leave room without trapping a stray key
const MAX_DIGITS = 3
// How long 'No channel 99' stays up
const MISSING_MS = 3000

/**
 * Channel zapping for CH+/CH- style controls. Each step moves `pending` at once
 * (so a banner can follow it), but the channel is tuned only once the viewer
 * has stopped pressing for `delayMs`. Tuning remounts the player, starts a new
 * ErsatzTV session and sends a presence update, so a burst of presses must
 * cost one tune, not one per press. Stepping back to the playing channel
 * doesn't tune at all. The last-channel key tunes at once: it is one press.
 *
 * Digits build a channel number, like a cable box: `pending` follows the
 * channel it matches so far, and the number is committed `entryDelayMs` after
 * the last digit, or at once with commitDigits (Enter). A number no channel
 * has tunes nothing and is reported in `missing` for a moment instead. A
 * fourth digit starts a new number. Stepping or going back drops the entry.
 */
export function useChannelZap({
  getChannels,
  selected,
  previousId = null,
  onTune,
  delayMs = 700,
  entryDelayMs = 1500,
}: UseChannelZapOptions): ChannelZap {
  const [pending, setPending] = useState<UnifiedChannel | null>(null)
  const pendingRef = useRef<UnifiedChannel | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [entry, setEntry] = useState<string | null>(null)
  const entryRef = useRef<string | null>(null)
  const [missing, setMissing] = useState<string | null>(null)
  const missingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef({ getChannels, selected, previousId, onTune, delayMs, entryDelayMs })

  useEffect(() => {
    latest.current = { getChannels, selected, previousId, onTune, delayMs, entryDelayMs }
  })

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (missingTimerRef.current) clearTimeout(missingTimerRef.current)
    },
    []
  )

  // Any new key replaces 'No channel 99'
  const clearMissing = useCallback(() => {
    if (missingTimerRef.current) clearTimeout(missingTimerRef.current)
    missingTimerRef.current = null
    setMissing(null)
  }, [])

  const clearEntry = useCallback(() => {
    if (entryRef.current === null) return
    entryRef.current = null
    pendingRef.current = null
    setEntry(null)
  }, [])

  const step = useCallback((dir: 1 | -1) => {
    const { getChannels, selected, delayMs } = latest.current
    const channels = getChannels()
    if (channels.length === 0) return
    clearMissing()
    clearEntry()

    const from = pendingRef.current ?? selected
    const index = from ? channels.findIndex((c) => c.id === from.id) : -1
    // With nothing to step from, up lands on the first channel and down on the last
    const nextIndex = index === -1
      ? (dir === 1 ? 0 : channels.length - 1)
      : (index + dir + channels.length) % channels.length
    const next = channels[nextIndex]

    pendingRef.current = next
    setPending(next)

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      const target = pendingRef.current
      pendingRef.current = null
      const { selected, onTune } = latest.current
      // Tune before clearing pending so the banner never falls back to the old channel
      if (target && target.id !== selected?.id) onTune(target)
      setPending(null)
    }, delayMs)
  }, [clearMissing, clearEntry])

  const tuneLast = useCallback(() => {
    const { getChannels, selected, previousId, onTune } = latest.current
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    clearMissing()
    clearEntry()
    pendingRef.current = null
    const last = previousId ? getChannels().find((c) => c.id === previousId) : undefined
    if (last && last.id !== selected?.id) onTune(last)
    setPending(null)
  }, [clearMissing, clearEntry])

  const commitDigits = useCallback((): boolean => {
    const typed = entryRef.current
    if (typed === null) return false
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null

    const { getChannels, selected, onTune } = latest.current
    const target = getChannels().find((c) => c.number === Number(typed))
    entryRef.current = null
    pendingRef.current = null
    // Tune before clearing pending so the rail never falls back to the old channel
    if (target) {
      if (target.id !== selected?.id) onTune(target)
    } else {
      setMissing(typed)
      missingTimerRef.current = setTimeout(() => {
        missingTimerRef.current = null
        setMissing(null)
      }, MISSING_MS)
    }
    setEntry(null)
    setPending(null)
    return true
  }, [])

  const digit = useCallback((digit: string) => {
    const { getChannels, entryDelayMs } = latest.current
    clearMissing()
    const current = entryRef.current
    const typed = current !== null && current.length < MAX_DIGITS ? current + digit : digit
    const match = getChannels().find((c) => c.number === Number(typed)) ?? null

    entryRef.current = typed
    setEntry(typed)
    // A step in progress gives way to the number
    pendingRef.current = match
    setPending(match)

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(commitDigits, entryDelayMs)
  }, [clearMissing, commitDigits])

  return { pending, step, tuneLast, entry, missing, digit, commitDigits }
}
