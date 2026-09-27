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

function setup(selected: UnifiedChannel | null, delayMs?: number, previousId: string | null = null) {
  const onTune = vi.fn<(channel: UnifiedChannel) => void>()
  const hook = renderHook(
    ({ selected, previousId }) => useChannelZap({ getChannels, selected, previousId, onTune, delayMs }),
    { initialProps: { selected, previousId } }
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
    rerender({ selected: channels[2], previousId: null })
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

  it('channel down three times (PageDown x3) tunes once, three channels down, after 700ms idle', () => {
    const { result, onTune } = setup(channels[5])

    act(() => result.current.step(-1))
    act(() => result.current.step(-1))
    act(() => result.current.step(-1))
    expect(result.current.pending).toBe(channels[2])
    act(() => { vi.advanceTimersByTime(699) })
    expect(onTune).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(1) })
    expect(onTune).toHaveBeenCalledTimes(1)
    expect(onTune).toHaveBeenCalledWith(channels[2])
  })

  describe('tuneLast', () => {
    it('tunes the previous channel at once', () => {
      const { result, onTune } = setup(channels[4], undefined, 'ch-1')

      act(() => result.current.tuneLast())

      expect(onTune).toHaveBeenCalledTimes(1)
      expect(onTune).toHaveBeenCalledWith(channels[1])
    })

    it('goes back and forth as the previous channel follows each tune', () => {
      const { result, onTune, rerender } = setup(channels[4], undefined, 'ch-1')

      act(() => result.current.tuneLast())
      rerender({ selected: channels[1], previousId: 'ch-4' })
      act(() => result.current.tuneLast())

      expect(onTune.mock.calls).toEqual([[channels[1]], [channels[4]]])
    })

    it('drops a step in progress instead of tuning it too', () => {
      const { result, onTune } = setup(channels[4], undefined, 'ch-1')

      act(() => result.current.step(1))
      act(() => result.current.tuneLast())
      expect(result.current.pending).toBeNull()
      act(() => { vi.advanceTimersByTime(700) })

      expect(onTune).toHaveBeenCalledTimes(1)
      expect(onTune).toHaveBeenCalledWith(channels[1])
    })

    it('does nothing without a previous channel, or when it is no longer listed', () => {
      const none = setup(channels[4])
      act(() => none.result.current.tuneLast())
      expect(none.onTune).not.toHaveBeenCalled()

      const gone = setup(channels[4], undefined, 'ch-99')
      act(() => gone.result.current.tuneLast())
      expect(gone.onTune).not.toHaveBeenCalled()
    })
  })

  describe('number entry', () => {
    // Slot 0 plus channels 1-36, as on the club's lineup
    const lineup = Array.from({ length: 37 }, (_, n) => channel(n))

    function setupDigits(selected: UnifiedChannel | null) {
      const onTune = vi.fn<(channel: UnifiedChannel) => void>()
      const hook = renderHook(() => useChannelZap({ getChannels: () => lineup, selected, onTune }))
      return { onTune, ...hook }
    }

    it("'1', '2' previews channel 12 and tunes it 1.5s after the last digit", () => {
      const { result, onTune } = setupDigits(lineup[3])

      act(() => result.current.digit('1'))
      expect(result.current.entry).toBe('1')
      expect(result.current.pending).toBe(lineup[1])
      act(() => { vi.advanceTimersByTime(1000) })
      act(() => result.current.digit('2'))
      expect(result.current.entry).toBe('12')
      expect(result.current.pending).toBe(lineup[12])

      act(() => { vi.advanceTimersByTime(1499) })
      expect(onTune).not.toHaveBeenCalled()
      act(() => { vi.advanceTimersByTime(1) })

      expect(onTune).toHaveBeenCalledTimes(1)
      expect(onTune).toHaveBeenCalledWith(lineup[12])
      expect(result.current.entry).toBeNull()
      expect(result.current.pending).toBeNull()
    })

    it('Enter (commitDigits) tunes at once', () => {
      const { result, onTune } = setupDigits(lineup[3])

      act(() => {
        result.current.digit('1')
        result.current.digit('2')
      })
      let committed = false
      act(() => { committed = result.current.commitDigits() })

      expect(committed).toBe(true)
      expect(onTune).toHaveBeenCalledWith(lineup[12])
      act(() => { vi.advanceTimersByTime(1500) })
      expect(onTune).toHaveBeenCalledTimes(1)
    })

    it('commitDigits with nothing typed does nothing and says so', () => {
      const { result, onTune } = setupDigits(lineup[3])

      let committed = true
      act(() => { committed = result.current.commitDigits() })

      expect(committed).toBe(false)
      expect(onTune).not.toHaveBeenCalled()
    })

    it("an unknown number tunes nothing and reports 'No channel 99' for 3s", () => {
      const { result, onTune } = setupDigits(lineup[3])

      act(() => {
        result.current.digit('9')
        result.current.digit('9')
      })
      expect(result.current.pending).toBeNull()
      act(() => { vi.advanceTimersByTime(1500) })

      expect(onTune).not.toHaveBeenCalled()
      expect(result.current.missing).toBe('99')
      expect(result.current.entry).toBeNull()
      act(() => { vi.advanceTimersByTime(3000) })
      expect(result.current.missing).toBeNull()
    })

    it('a new key replaces the missing number at once', () => {
      const { result } = setupDigits(lineup[3])

      act(() => {
        result.current.digit('9')
        result.current.digit('9')
        result.current.commitDigits()
      })
      expect(result.current.missing).toBe('99')

      act(() => result.current.digit('4'))
      expect(result.current.missing).toBeNull()
      expect(result.current.entry).toBe('4')
    })

    it("'0' tunes the live slot", () => {
      const { result, onTune } = setupDigits(lineup[3])

      act(() => result.current.digit('0'))
      act(() => { vi.advanceTimersByTime(1500) })

      expect(onTune).toHaveBeenCalledWith(lineup[0])
    })

    it("typing the playing channel's number doesn't tune it again", () => {
      const { result, onTune } = setupDigits(lineup[7])

      act(() => result.current.digit('7'))
      act(() => { vi.advanceTimersByTime(1500) })

      expect(onTune).not.toHaveBeenCalled()
    })

    it('a fourth digit starts a new number', () => {
      const { result } = setupDigits(lineup[3])

      act(() => {
        for (const d of ['1', '2', '3', '2']) result.current.digit(d)
      })

      expect(result.current.entry).toBe('2')
      expect(result.current.pending).toBe(lineup[2])
    })

    it('a step drops the number being typed and steps from the playing channel', () => {
      const { result, onTune } = setupDigits(lineup[3])

      act(() => result.current.digit('2'))
      act(() => result.current.step(1))
      expect(result.current.entry).toBeNull()
      expect(result.current.pending).toBe(lineup[4])
      act(() => { vi.advanceTimersByTime(1500) })

      expect(onTune).toHaveBeenCalledTimes(1)
      expect(onTune).toHaveBeenCalledWith(lineup[4])
    })

    it('a digit drops a step in progress', () => {
      const { result, onTune } = setupDigits(lineup[3])

      act(() => result.current.step(1))
      act(() => result.current.digit('9'))
      act(() => { vi.advanceTimersByTime(1500) })

      expect(onTune).toHaveBeenCalledTimes(1)
      expect(onTune).toHaveBeenCalledWith(lineup[9])
    })
  })

  it('does not tune after unmounting', () => {
    const { result, onTune, unmount } = setup(channels[1])

    act(() => result.current.step(1))
    unmount()
    act(() => { vi.advanceTimersByTime(700) })

    expect(onTune).not.toHaveBeenCalled()
  })
})
