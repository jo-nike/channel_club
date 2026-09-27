import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { toast } from 'sonner'
import { useProgrammeReminders } from './useProgrammeReminders'
import { REMINDER_GRACE_MS, useReminderStore, type ProgrammeReminder } from '@/stores/reminderStore'
import { useTVStore, LIVE_CHANNEL_ID } from '@/stores/tvStore'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { useChannelStore } from '@/stores/channelStore'
import type { ErsatzTVChannel } from '@/types'

vi.mock('sonner', () => ({
  toast: vi.fn(),
}))

// Selecting the live slot looks up its guide
vi.mock('@/services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/api')>()),
  fetchNowPlaying: vi.fn(async () => ({ channelId: 'tsn5', currentProgram: null, nextProgram: null })),
}))

const NOW = new Date('2026-01-03T19:00:00Z').getTime()

const cartoons: ErsatzTVChannel = {
  id: 'ch2',
  name: 'Cartoons',
  streamUrl: '',
  logoUrl: '',
  number: 2,
  group: '',
}

const futurama: ProgrammeReminder = {
  programmeId: 'ch2_1',
  channelId: 'ch2',
  channelName: 'Cartoons',
  title: 'Futurama',
  startMs: NOW + 2 * 60_000,
}

type ToastOptions = NonNullable<Parameters<typeof toast>[1]>

function lastToast(): [string, ToastOptions] {
  const call = vi.mocked(toast).mock.calls.at(-1)
  if (!call) throw new Error('no toast')
  return [String(call[0]), call[1] ?? {}]
}

/** The Watch action's click handler, from the last toast. */
function clickWatch() {
  const action = lastToast()[1].action
  // sonner's action is a ReactNode or an { label, onClick } object
  if (!action || typeof action !== 'object' || !('onClick' in action)) throw new Error('no Watch action')
  act(() => {
    action.onClick({} as Parameters<typeof action.onClick>[0])
  })
}

const reminderIds = () => useReminderStore.getState().reminders.map((r) => r.programmeId)

describe('useProgrammeReminders', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    vi.mocked(toast).mockClear()
    useReminderStore.setState({ reminders: [] })
    useErsatztvStore.setState({ channels: [cartoons] })
    useChannelStore.setState({ currentChannel: null })
    useTVStore.setState({ selectedChannel: null })
  })

  afterEach(() => {
    vi.useRealTimers()
    useErsatztvStore.setState({ channels: [] })
  })

  it('toasts when the programme starts, not before', () => {
    useReminderStore.getState().add(futurama)
    renderHook(() => useProgrammeReminders())

    act(() => {
      vi.advanceTimersByTime(2 * 60_000 - 1)
    })
    expect(toast).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(toast).toHaveBeenCalledTimes(1)
    const [message, options] = lastToast()
    expect(message).toBe('Futurama starts now on Cartoons')
    expect(options.action).toMatchObject({ label: 'Watch' })
  })

  it('forgets a reminder once it has gone off', () => {
    useReminderStore.getState().add(futurama)
    renderHook(() => useProgrammeReminders())

    act(() => {
      vi.advanceTimersByTime(2 * 60_000)
    })
    expect(reminderIds()).toEqual([])

    act(() => {
      vi.advanceTimersByTime(60 * 60_000)
    })
    expect(toast).toHaveBeenCalledTimes(1)
  })

  it('Watch selects the channel', () => {
    useReminderStore.getState().add(futurama)
    renderHook(() => useProgrammeReminders())
    act(() => {
      vi.advanceTimersByTime(2 * 60_000)
    })

    clickWatch()

    expect(useTVStore.getState().selectedChannel).toMatchObject({ id: 'ch2', type: 'ersatztv' })
  })

  it('a live-row reminder names the live channel and Watch selects the live slot', () => {
    useChannelStore.setState({ currentChannel: { id: '7', name: 'TSN 5', streamUrl: '/live', guideId: 'tsn5' } })
    useReminderStore.getState().add({
      ...futurama,
      programmeId: 'live-2026-01-03T19:02:00Z',
      channelId: LIVE_CHANNEL_ID,
      channelName: 'TSN 5',
      liveChannelId: '7',
      title: 'Hockey Night',
    })
    renderHook(() => useProgrammeReminders())
    act(() => {
      vi.advanceTimersByTime(2 * 60_000)
    })

    expect(lastToast()[0]).toBe('Hockey Night starts now on TSN 5')
    clickWatch()
    expect(useTVStore.getState().selectedChannel).toEqual(useTVStore.getState().getUnifiedChannels()[0])
    expect(useTVStore.getState().selectedChannel).toMatchObject({ id: LIVE_CHANNEL_ID, type: 'live', name: 'TSN 5' })
    expect(reminderIds()).toEqual([])
  })

  it('a live-row reminder names the saved channel, without Watch, once the live slot carries another channel', () => {
    useChannelStore.setState({ currentChannel: { id: '7', name: 'TSN 5', streamUrl: '/live', guideId: 'tsn5' } })
    useReminderStore.getState().add({
      ...futurama,
      programmeId: 'live-2026-01-03T19:02:00Z',
      channelId: LIVE_CHANNEL_ID,
      channelName: 'TSN 5',
      liveChannelId: '7',
      title: 'Hockey Night',
    })
    renderHook(() => useProgrammeReminders())
    // The admin puts CNN on the live slot before the start
    useChannelStore.setState({ currentChannel: { id: '9', name: 'CNN', streamUrl: '/cnn', guideId: 'cnn' } })

    act(() => {
      vi.advanceTimersByTime(2 * 60_000)
    })

    expect(toast).toHaveBeenCalledTimes(1)
    expect(lastToast()[0]).toBe('Hockey Night starts now on TSN 5')
    expect(lastToast()[1].action).toBeUndefined()
    expect(reminderIds()).toEqual([])
  })

  it('Watch does not tune the live slot if it switched channel after the toast', () => {
    useChannelStore.setState({ currentChannel: { id: '7', name: 'TSN 5', streamUrl: '/live', guideId: 'tsn5' } })
    useReminderStore.getState().add({
      ...futurama,
      programmeId: 'live-2026-01-03T19:02:00Z',
      channelId: LIVE_CHANNEL_ID,
      channelName: 'TSN 5',
      liveChannelId: '7',
      title: 'Hockey Night',
    })
    renderHook(() => useProgrammeReminders())
    act(() => {
      vi.advanceTimersByTime(2 * 60_000)
    })
    useChannelStore.setState({ currentChannel: { id: '9', name: 'CNN', streamUrl: '/cnn', guideId: 'cnn' } })

    clickWatch()

    expect(useTVStore.getState().selectedChannel).toBeNull()
  })

  it('goes off for each reminder in turn', () => {
    useReminderStore.getState().add({ ...futurama, programmeId: 'later', title: 'Later', startMs: NOW + 10 * 60_000 })
    useReminderStore.getState().add(futurama)
    renderHook(() => useProgrammeReminders())

    act(() => {
      vi.advanceTimersByTime(2 * 60_000)
    })
    expect(lastToast()[0]).toBe('Futurama starts now on Cartoons')
    expect(reminderIds()).toEqual(['later'])

    act(() => {
      vi.advanceTimersByTime(8 * 60_000)
    })
    expect(toast).toHaveBeenCalledTimes(2)
    expect(lastToast()[0]).toBe('Later starts now on Cartoons')
  })

  it('prunes a reminder long past without a toast', () => {
    useReminderStore.setState({ reminders: [{ ...futurama, startMs: NOW - REMINDER_GRACE_MS - 1 }] })
    renderHook(() => useProgrammeReminders())

    act(() => {
      vi.advanceTimersByTime(0)
    })

    expect(toast).not.toHaveBeenCalled()
    expect(reminderIds()).toEqual([])
  })

  it('still goes off for a programme that started moments ago', () => {
    useReminderStore.setState({ reminders: [{ ...futurama, startMs: NOW - 30_000 }] })
    renderHook(() => useProgrammeReminders())

    act(() => {
      vi.advanceTimersByTime(0)
    })

    expect(lastToast()[0]).toBe('Futurama starts now on Cartoons')
  })

  it('offers no Watch when you are already on that channel', () => {
    useTVStore.setState({
      selectedChannel: { id: 'ch2', name: 'Cartoons', number: 2, streamUrl: '', type: 'ersatztv' },
    })
    useReminderStore.getState().add(futurama)
    renderHook(() => useProgrammeReminders())
    act(() => {
      vi.advanceTimersByTime(2 * 60_000)
    })

    expect(lastToast()[0]).toBe('Futurama starts now on Cartoons')
    expect(lastToast()[1].action).toBeUndefined()
  })

  it("falls back to the saved channel name, without Watch, when the channel isn't listed", () => {
    useErsatztvStore.setState({ channels: [] })
    useReminderStore.getState().add(futurama)
    renderHook(() => useProgrammeReminders())
    act(() => {
      vi.advanceTimersByTime(2 * 60_000)
    })

    expect(lastToast()[0]).toBe('Futurama starts now on Cartoons')
    expect(lastToast()[1].action).toBeUndefined()
  })

  it('waits again when the timer fires before the wall clock reaches the start', () => {
    useReminderStore.getState().add(futurama)
    renderHook(() => useProgrammeReminders())
    // The wall clock falls a minute behind the timers
    vi.setSystemTime(NOW - 60_000)

    act(() => {
      vi.advanceTimersByTime(2 * 60_000)
    })
    expect(toast).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(lastToast()[0]).toBe('Futurama starts now on Cartoons')
  })

  it('picks up a reminder added while it is running', () => {
    renderHook(() => useProgrammeReminders())
    act(() => {
      useReminderStore.getState().add(futurama)
    })

    act(() => {
      vi.advanceTimersByTime(2 * 60_000)
    })
    expect(toast).toHaveBeenCalledTimes(1)
  })

  it('does not go off for a reminder removed before its start', () => {
    useReminderStore.getState().add(futurama)
    renderHook(() => useProgrammeReminders())
    act(() => {
      useReminderStore.getState().remove(futurama.channelId, futurama.programmeId)
    })

    act(() => {
      vi.advanceTimersByTime(2 * 60_000)
    })
    expect(toast).not.toHaveBeenCalled()
  })

  it('stops when unmounted', () => {
    useReminderStore.getState().add(futurama)
    const { unmount } = renderHook(() => useProgrammeReminders())
    unmount()

    act(() => {
      vi.advanceTimersByTime(2 * 60_000)
    })
    expect(toast).not.toHaveBeenCalled()
    expect(reminderIds()).toEqual(['ch2_1'])
  })
})
