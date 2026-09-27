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
}

export interface ChannelZap {
  /** The channel the viewer has stepped to but not tuned yet, or null. */
  pending: UnifiedChannel | null
  /** Steps one channel up (+1, next higher number) or down (-1), wrapping. */
  step: (dir: 1 | -1) => void
  /** Tunes straight back to the previous channel, dropping any step in progress. */
  tuneLast: () => void
}

/**
 * Channel zapping for CH+/CH- style controls. Each step moves `pending` at once
 * (so a banner can follow it), but the channel is tuned only once the viewer
 * has stopped pressing for `delayMs`. Tuning remounts the player, starts a new
 * ErsatzTV session and sends a presence update, so a burst of presses must
 * cost one tune, not one per press. Stepping back to the playing channel
 * doesn't tune at all. The last-channel key tunes at once: it is one press.
 */
export function useChannelZap({
  getChannels,
  selected,
  previousId = null,
  onTune,
  delayMs = 700,
}: UseChannelZapOptions): ChannelZap {
  const [pending, setPending] = useState<UnifiedChannel | null>(null)
  const pendingRef = useRef<UnifiedChannel | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef({ getChannels, selected, previousId, onTune, delayMs })

  useEffect(() => {
    latest.current = { getChannels, selected, previousId, onTune, delayMs }
  })

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    []
  )

  const step = useCallback((dir: 1 | -1) => {
    const { getChannels, selected, delayMs } = latest.current
    const channels = getChannels()
    if (channels.length === 0) return

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
  }, [])

  const tuneLast = useCallback(() => {
    const { getChannels, selected, previousId, onTune } = latest.current
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    pendingRef.current = null
    const last = previousId ? getChannels().find((c) => c.id === previousId) : undefined
    if (last && last.id !== selected?.id) onTune(last)
    setPending(null)
  }, [])

  return { pending, step, tuneLast }
}
