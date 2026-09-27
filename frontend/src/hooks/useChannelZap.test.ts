import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useChannelZap } from './useChannelZap'
import type { UnifiedChannel } from '@/types'

const channel = (number: number): UnifiedChannel => ({
  id: `ch-${number}`,
  name: `Channel ${number}`,
  number,
  streamUrl: `http://example.test/${number}.m3u8`,
  type: number === 0 ? 'live' : 'ersatztv',
})

// Slot 0 (live) plus channels 1-5
const channels = [0, 1, 2, 3, 4, 5].map(channel)
const getChannels = () => channels

function setup(selected: UnifiedChannel | null, delayMs?: number) {
  const onTune = vi.fn<(channel: UnifiedChannel) => void>()
  const hook = renderHook(
    ({ selected }) => useChannelZap({ getChannels, selected, onTune, delayMs }),
    { initialProps: { selected } }
  )
  return { onTune, ...hook }
}

describe('useChannelZap', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('moves pending at once without tuning', () => {
    const { result, onTune } = setup(channels[1])

    act(() => result.current.step(1))

    expect(result.current.pending).toBe(channels[2])
    expect(onTune).not.toHaveBeenCalled()
  })

  it('tunes once, to index + 3, after three quick steps and 700ms idle', () => {
    const { result, onTune } = setup(channels[1])

    act(() => result.current.step(1))
    act(() => { vi.advanceTimersByTime(300) })
    act(() => result.current.step(1))
    act(() => { vi.advanceTimersByTime(300) })
    act(() => result.current.step(1))
    expect(result.current.pending).toBe(channels[4])

    act(() => { vi.advanceTimersByTime(699) })
    expect(onTune).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(1) })
    expect(onTune).toHaveBeenCalledTimes(1)
    expect(onTune).toHaveBeenCalledWith(channels[4])
    expect(result.current.pending).toBeNull()
  })

  it('handles steps made in the same tick', () => {
    const { result, onTune } = setup(channels[1])

    act(() => {
      result.current.step(1)
      result.current.step(1)
    })
    act(() => { vi.advanceTimersByTime(700) })

    expect(onTune).toHaveBeenCalledWith(channels[3])
  })

  it('wraps from the last channel to slot 0', () => {
    const { result, onTune } = setup(channels[5])

    act(() => result.current.step(1))
    act(() => { vi.advanceTimersByTime(700) })

    expect(onTune).toHaveBeenCalledWith(channels[0])
  })

  it('wraps from slot 0 down to the last channel', () => {
    const { result, onTune } = setup(channels[0])

    act(() => result.current.step(-1))
    act(() => { vi.advanceTimersByTime(700) })

    expect(onTune).toHaveBeenCalledWith(channels[5])
  })

  it('does not tune when the viewer steps back to the playing channel', () => {
    const { result, onTune } = setup(channels[2])

    act(() => result.current.step(1))
    act(() => result.current.step(-1))
    expect(result.current.pending).toBe(channels[2])

    act(() => { vi.advanceTimersByTime(700) })

    expect(onTune).not.toHaveBeenCalled()
    expect(result.current.pending).toBeNull()
  })

  it('steps from the newly selected channel after a tune', () => {
    const { result, onTune, rerender } = setup(channels[1])

    act(() => result.current.step(1))
    act(() => { vi.advanceTimersByTime(700) })
    rerender({ selected: channels[2] })
    act(() => result.current.step(1))
    act(() => { vi.advanceTimersByTime(700) })

    expect(onTune).toHaveBeenLastCalledWith(channels[3])
  })

  it('starts from the first channel going up and the last going down when nothing is selected', () => {
    const { result } = setup(null)

    act(() => result.current.step(1))
    expect(result.current.pending).toBe(channels[0])

    const other = setup(null)
    act(() => other.result.current.step(-1))
    expect(other.result.current.pending).toBe(channels[5])
  })

  it('honours a custom delay', () => {
    const { result, onTune } = setup(channels[1], 200)

    act(() => result.current.step(1))
    act(() => { vi.advanceTimersByTime(200) })

    expect(onTune).toHaveBeenCalledWith(channels[2])
  })

  it('does not tune after unmounting', () => {
    const { result, onTune, unmount } = setup(channels[1])

    act(() => result.current.step(1))
    unmount()
    act(() => { vi.advanceTimersByTime(700) })

    expect(onTune).not.toHaveBeenCalled()
  })
})
