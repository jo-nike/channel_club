import { render, screen, fireEvent, act } from '@/test/utils'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { ProgrammeDetailsModal } from './ProgrammeDetailsModal'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { useTVStore, LIVE_CHANNEL_ID, toLiveProgramme } from '@/stores/tvStore'
import { useReminderStore } from '@/stores/reminderStore'
import { useChannelStore } from '@/stores/channelStore'
import type { ErsatzTVProgramme, ErsatzTVChannel, UnifiedChannel } from '@/types'

describe('ProgrammeDetailsModal', () => {
  const mockProgramme: ErsatzTVProgramme = {
    id: 'p1',
    channelId: 'ch1',
    title: 'Test Movie',
    description: 'A test movie description',
    start: '2026-01-03T14:00:00Z',
    stop: '2026-01-03T16:00:00Z',
    category: ['Movie', 'Comedy'],
  }

  const mockChannel: ErsatzTVChannel = {
    id: 'ch1',
    name: 'Comedy Classics',
    number: 1,
    group: 'Movies',
    streamUrl: 'http://example.com/stream.m3u8',
    logoUrl: '/api/ersatztv/logo/ch1',
  }

  const defaultProps = {
    programme: mockProgramme,
    channel: mockChannel,
    open: true,
    onOpenChange: vi.fn(),
    onWatch: vi.fn(),
  }

  // Test Movie runs 14:00-16:00Z; by default the clock sits halfway through it.
  const DURING = new Date('2026-01-03T15:00:00Z')

  const onAir: ErsatzTVProgramme = {
    id: 'p0',
    channelId: 'ch1',
    title: 'Morning Cartoons',
    start: '2026-01-03T12:12:00Z',
    stop: '2026-01-03T14:00:00Z',
  }

  const watching: UnifiedChannel = {
    id: 'ch1',
    name: 'Comedy Classics',
    number: 1,
    streamUrl: 'http://example.com/stream.m3u8',
    type: 'ersatztv',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(DURING)
    useTVStore.setState({ selectedChannel: null, liveProgrammes: [] })
    useErsatztvStore.setState({ programmesByChannel: {} })
    useReminderStore.setState({ reminders: [] })
    useChannelStore.setState({ currentChannel: null })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('displays programme title', () => {
    render(<ProgrammeDetailsModal {...defaultProps} />)
    expect(screen.getByText('Test Movie')).toBeInTheDocument()
  })

  it('displays time range with duration', () => {
    render(<ProgrammeDetailsModal {...defaultProps} />)
    // Check for the duration (120 min)
    expect(screen.getByText(/120 min/)).toBeInTheDocument()
  })

  it('displays channel name', () => {
    render(<ProgrammeDetailsModal {...defaultProps} />)
    expect(screen.getByText(/Comedy Classics/)).toBeInTheDocument()
  })

  it('displays description', () => {
    render(<ProgrammeDetailsModal {...defaultProps} />)
    expect(screen.getByText('A test movie description')).toBeInTheDocument()
  })

  it('shows fallback when no description', () => {
    const programmeWithoutDesc: ErsatzTVProgramme = {
      ...mockProgramme,
      description: undefined,
    }
    render(
      <ProgrammeDetailsModal {...defaultProps} programme={programmeWithoutDesc} />
    )
    expect(screen.getByText('No description available')).toBeInTheDocument()
  })

  it('does not show category section when no categories', () => {
    const programmeWithoutCategories: ErsatzTVProgramme = {
      ...mockProgramme,
      category: undefined,
    }
    render(
      <ProgrammeDetailsModal
        {...defaultProps}
        programme={programmeWithoutCategories}
      />
    )
    expect(screen.queryByText('Movie')).not.toBeInTheDocument()
    expect(screen.queryByText('Comedy')).not.toBeInTheDocument()
  })

  it('calls onWatch with channel when Watch Now button clicked', () => {
    const onWatch = vi.fn()
    render(<ProgrammeDetailsModal {...defaultProps} onWatch={onWatch} />)

    fireEvent.click(screen.getByRole('button', { name: /watch now/i }))
    expect(onWatch).toHaveBeenCalledWith(mockChannel)
  })

  it('closes modal when Watch Now button clicked', () => {
    const onOpenChange = vi.fn()
    render(<ProgrammeDetailsModal {...defaultProps} onOpenChange={onOpenChange} />)

    fireEvent.click(screen.getByRole('button', { name: /watch now/i }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('has no footer Close button, only the dialog X', () => {
    render(<ProgrammeDetailsModal {...defaultProps} />)

    const closeButtons = screen.getAllByRole('button', { name: /close/i })
    expect(closeButtons).toHaveLength(1)
    expect(closeButtons[0]).toHaveAttribute('data-slot', 'dialog-close')
  })

  describe('actions by programme state', () => {
    it('upcoming: says when it starts and offers the channel as it is now', () => {
      // 1h 48m before Test Movie starts at 14:00Z
      vi.setSystemTime(new Date('2026-01-03T12:12:00Z'))
      useErsatztvStore.setState({ programmesByChannel: { ch1: [onAir, mockProgramme] } })
      const onWatch = vi.fn()
      render(<ProgrammeDetailsModal {...defaultProps} onWatch={onWatch} />)

      expect(screen.getByText(/In 1h 48m ·/)).toBeInTheDocument()
      expect(screen.getByText('On now: Morning Cartoons')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Watch now' })).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Watch Comedy Classics now' }))
      expect(onWatch).toHaveBeenCalledWith(mockChannel)
    })

    it('upcoming: leaves out the on-now hint when nothing is on air', () => {
      vi.setSystemTime(new Date('2026-01-03T12:12:00Z'))
      render(<ProgrammeDetailsModal {...defaultProps} />)

      expect(screen.getByRole('button', { name: 'Watch Comedy Classics now' })).toBeInTheDocument()
      expect(screen.queryByText(/On now:/)).not.toBeInTheDocument()
    })

    it('on now: shows the time left and a primary Watch now', () => {
      vi.setSystemTime(new Date('2026-01-03T15:28:00Z'))
      useErsatztvStore.setState({ programmesByChannel: { ch1: [onAir, mockProgramme] } })
      render(<ProgrammeDetailsModal {...defaultProps} />)

      expect(screen.getByText(/32m left ·/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Watch now' })).toBeInTheDocument()
      expect(screen.queryByText(/On now:/)).not.toBeInTheDocument()
    })

    it('watching: says so and offers no watch button', () => {
      useTVStore.setState({ selectedChannel: watching })
      render(<ProgrammeDetailsModal {...defaultProps} />)

      expect(screen.getByText("You're watching this")).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /watch/i })).not.toBeInTheDocument()
    })

    it('ended: says when it ended and offers only the channel as it is now', () => {
      vi.setSystemTime(new Date('2026-01-03T16:10:00Z'))
      useErsatztvStore.setState({
        programmesByChannel: {
          ch1: [
            mockProgramme,
            { ...onAir, id: 'p2', title: 'Evening News', start: '2026-01-03T16:00:00Z', stop: '2026-01-03T16:30:00Z' },
          ],
        },
      })
      render(<ProgrammeDetailsModal {...defaultProps} />)

      expect(screen.getByText(/Ended at/)).toBeInTheDocument()
      expect(screen.getByText('On now: Evening News')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Watch now' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Watch Comedy Classics now' })).toBeInTheDocument()
    })

    it('upcoming on the channel you are watching: no watch button, since it would do nothing', () => {
      vi.setSystemTime(new Date('2026-01-03T12:12:00Z'))
      useTVStore.setState({ selectedChannel: watching })
      render(<ProgrammeDetailsModal {...defaultProps} />)

      expect(screen.getByText("You're watching Comedy Classics")).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /watch/i })).not.toBeInTheDocument()
    })

    // jsdom has no layout, so these guard the classes that keep the footer inside the dialog
    describe('upcoming footer layout', () => {
      const longOnAir = { ...onAir, title: 'Mission: Impossible - Dead Reckoning Part One' }

      beforeEach(() => {
        vi.setSystemTime(new Date('2026-01-03T12:12:00Z'))
        useErsatztvStore.setState({ programmesByChannel: { ch1: [longOnAir, mockProgramme] } })
      })

      it('wraps, with On now on a row of its own, instead of widening the dialog', () => {
        render(<ProgrammeDetailsModal {...defaultProps} />)

        const remind = screen.getByRole('button', { name: /Remind me at/ })
        const footer = remind.closest('[data-slot="dialog-footer"]')
        expect(footer).toHaveClass('sm:flex-wrap')
        expect(screen.getByText(`On now: ${longOnAir.title}`)).toHaveClass('sm:basis-full')
        expect(screen.getByRole('button', { name: 'Watch Comedy Classics now' })).toHaveClass('sm:mr-auto')
      })

      it('puts You are watching left of Remind me on the channel you are watching', () => {
        useTVStore.setState({ selectedChannel: watching })
        render(<ProgrammeDetailsModal {...defaultProps} />)

        expect(screen.getByText(`On now: ${longOnAir.title}`)).toHaveClass('sm:basis-full')
        expect(screen.getByText("You're watching Comedy Classics")).toHaveClass('sm:mr-auto')
      })
    })

    it('moves from upcoming to on now when the clock passes the start', () => {
      vi.setSystemTime(new Date('2026-01-03T13:59:45Z'))
      render(<ProgrammeDetailsModal {...defaultProps} />)
      expect(screen.getByText(/In 1m ·/)).toBeInTheDocument()

      act(() => {
        vi.advanceTimersByTime(30_000)
      })
      expect(screen.getByRole('button', { name: 'Watch now' })).toBeInTheDocument()
    })
  })

  describe('reminders', () => {
    const BEFORE = new Date('2026-01-03T12:12:00Z')

    it('upcoming: Remind me sets a reminder for this programme and shows it is set', () => {
      vi.setSystemTime(BEFORE)
      render(<ProgrammeDetailsModal {...defaultProps} />)

      const remind = screen.getByRole('button', { name: /^Remind me at / })
      expect(remind).toHaveAttribute('aria-pressed', 'false')
      fireEvent.click(remind)

      expect(useReminderStore.getState().reminders).toEqual([
        {
          programmeId: 'p1',
          channelId: 'ch1',
          channelName: 'Comedy Classics',
          title: 'Test Movie',
          startMs: new Date('2026-01-03T14:00:00Z').getTime(),
        },
      ])
      const set = screen.getByRole('button', { name: 'Reminder set' })
      expect(set).toHaveAttribute('aria-pressed', 'true')
    })

    it('upcoming: Reminder set clears the reminder again', () => {
      vi.setSystemTime(BEFORE)
      render(<ProgrammeDetailsModal {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: /^Remind me at / }))
      fireEvent.click(screen.getByRole('button', { name: 'Reminder set' }))

      expect(useReminderStore.getState().reminders).toEqual([])
      expect(screen.getByRole('button', { name: /^Remind me at / })).toBeInTheDocument()
    })

    it('shows a reminder set earlier as set', () => {
      vi.setSystemTime(BEFORE)
      useReminderStore.getState().add({
        programmeId: 'p1',
        channelId: 'ch1',
        channelName: 'Comedy Classics',
        title: 'Test Movie',
        startMs: new Date('2026-01-03T14:00:00Z').getTime(),
      })
      render(<ProgrammeDetailsModal {...defaultProps} />)

      expect(screen.getByRole('button', { name: 'Reminder set' })).toBeInTheDocument()
    })

    it('says the reminder only shows while a tab is open, not as a push notification', () => {
      vi.setSystemTime(BEFORE)
      render(<ProgrammeDetailsModal {...defaultProps} />)

      const remind = screen.getByRole('button', { name: /^Remind me at / })
      expect(remind).toHaveAccessibleDescription(/as long as Channel Club is open in a tab/)
      expect(screen.queryByText(/notif|push/i)).not.toBeInTheDocument()
    })

    it('upcoming on the channel you are watching still offers Remind me', () => {
      vi.setSystemTime(BEFORE)
      useTVStore.setState({ selectedChannel: watching })
      render(<ProgrammeDetailsModal {...defaultProps} />)

      expect(screen.getByRole('button', { name: /^Remind me at / })).toBeInTheDocument()
    })

    it.each([
      ['on now', '2026-01-03T15:00:00Z'],
      ['ended', '2026-01-03T16:10:00Z'],
    ])('%s: offers no reminder', (_state, at) => {
      vi.setSystemTime(new Date(at))
      render(<ProgrammeDetailsModal {...defaultProps} />)

      expect(screen.queryByRole('button', { name: /remind/i })).not.toBeInTheDocument()
      expect(screen.queryByText(/A reminder pops up/)).not.toBeInTheDocument()
    })

    it('a live-row programme is reminded on the live slot, with the live channel it is on', () => {
      vi.setSystemTime(BEFORE)
      useChannelStore.setState({ currentChannel: { id: '7', name: 'CA-S: TSN 5', streamUrl: '/live', guideId: 'tsn5' } })
      const hockey = toLiveProgramme({ title: 'Hockey Night', startTime: '2026-01-03T13:00:00Z', endTime: '2026-01-03T16:00:00Z' })
      render(
        <ProgrammeDetailsModal {...defaultProps} programme={hockey} channel={{ id: LIVE_CHANNEL_ID, name: 'CA-S: TSN 5' }} />
      )

      fireEvent.click(screen.getByRole('button', { name: /^Remind me at / }))

      expect(useReminderStore.getState().reminders).toEqual([
        {
          programmeId: hockey.id,
          channelId: LIVE_CHANNEL_ID,
          channelName: 'CA-S: TSN 5',
          liveChannelId: '7',
          title: 'Hockey Night',
          startMs: new Date('2026-01-03T13:00:00Z').getTime(),
        },
      ])
    })

    it("a live-row reminder isn't shown as set once the live slot carries another channel", () => {
      vi.setSystemTime(BEFORE)
      useReminderStore.getState().add({
        programmeId: 'live-2026-01-03T13:00:00Z',
        channelId: LIVE_CHANNEL_ID,
        channelName: 'CA-S: TSN 5',
        liveChannelId: '7',
        title: 'Hockey Night',
        startMs: new Date('2026-01-03T13:00:00Z').getTime(),
      })
      // The admin has put CNN on the live slot; its 13:00 programme has the same id
      useChannelStore.setState({ currentChannel: { id: '9', name: 'CNN', streamUrl: '/cnn', guideId: 'cnn' } })
      const ac360 = toLiveProgramme({ title: 'AC360', startTime: '2026-01-03T13:00:00Z', endTime: '2026-01-03T14:00:00Z' })
      render(<ProgrammeDetailsModal {...defaultProps} programme={ac360} channel={{ id: LIVE_CHANNEL_ID, name: 'CNN' }} />)

      const remind = screen.getByRole('button', { name: /^Remind me at / })
      expect(remind).toHaveAttribute('aria-pressed', 'false')
      fireEvent.click(remind)

      expect(useReminderStore.getState().reminders.map((r) => [r.title, r.liveChannelId])).toEqual([
        ['Hockey Night', '7'],
        ['AC360', '9'],
      ])
    })
  })

  describe('on the live slot', () => {
    const liveSlot = { id: LIVE_CHANNEL_ID, name: 'CA-S: TSN 5' }
    const [pregame, hockey] = [
      { title: 'Pre-game', startTime: '2026-01-03T12:00:00Z', endTime: '2026-01-03T13:00:00Z' },
      { title: 'Hockey Night', startTime: '2026-01-03T13:00:00Z', endTime: '2026-01-03T16:00:00Z', description: 'Leafs at Habs' },
    ].map(toLiveProgramme)

    it("upcoming: shows what's on the live channel now, from the live schedule, and offers the live slot", () => {
      vi.setSystemTime(new Date('2026-01-03T12:30:00Z'))
      useTVStore.setState({ liveProgrammes: [pregame, hockey] })
      const onWatch = vi.fn()
      render(<ProgrammeDetailsModal {...defaultProps} programme={hockey} channel={liveSlot} onWatch={onWatch} />)

      expect(screen.getByText('Hockey Night')).toBeInTheDocument()
      expect(screen.getByText('Leafs at Habs')).toBeInTheDocument()
      expect(screen.getByText(/In 30m ·.*CA-S: TSN 5/)).toBeInTheDocument()
      expect(screen.getByText('On now: Pre-game')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Watch CA-S: TSN 5 now' }))
      expect(onWatch).toHaveBeenCalledWith(liveSlot)
    })

    it("upcoming while watching the live slot: says so and offers no watch button", () => {
      vi.setSystemTime(new Date('2026-01-03T12:30:00Z'))
      useTVStore.setState({
        liveProgrammes: [pregame, hockey],
        selectedChannel: { id: LIVE_CHANNEL_ID, name: 'CA-S: TSN 5', number: 0, streamUrl: '/live', type: 'live' },
      })
      render(<ProgrammeDetailsModal {...defaultProps} programme={hockey} channel={liveSlot} />)

      expect(screen.getByText("You're watching CA-S: TSN 5")).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /watch/i })).not.toBeInTheDocument()
    })
  })

  it('returns null when programme is null', () => {
    const { container } = render(
      <ProgrammeDetailsModal {...defaultProps} programme={null} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('returns null when channel is null', () => {
    const { container } = render(
      <ProgrammeDetailsModal {...defaultProps} channel={null} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('does not render when open is false', () => {
    render(<ProgrammeDetailsModal {...defaultProps} open={false} />)
    // Dialog should not render its content when closed
    expect(screen.queryByText('Test Movie')).not.toBeInTheDocument()
  })

  it('has proper dialog role for accessibility', () => {
    render(<ProgrammeDetailsModal {...defaultProps} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('caps its height and scrolls inside, so a long synopsis fits a phone screen', () => {
    render(<ProgrammeDetailsModal {...defaultProps} />)
    expect(screen.getByRole('dialog')).toHaveClass('max-h-[85dvh]', 'overflow-y-auto')
  })

  // The guide opens it by state from a programme cell, with no Radix trigger to return focus to
  describe('focus on close', () => {
    function Guide() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" tabIndex={0} onClick={() => setOpen(true)}>
            Test Movie cell
          </button>
          <ProgrammeDetailsModal {...defaultProps} open={open} onOpenChange={setOpen} />
        </>
      )
    }

    // Radix moves focus on the next tick
    const tick = () => act(() => vi.advanceTimersByTime(1))

    it('returns focus to the programme cell that opened it when Escape closes it', () => {
      render(<Guide />)
      const cell = screen.getByRole('button', { name: 'Test Movie cell' })
      cell.focus()
      fireEvent.click(cell)
      const dialog = screen.getByRole('dialog')
      tick()
      expect(cell).not.toHaveFocus()

      fireEvent.keyDown(dialog, { key: 'Escape' })
      tick()

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(cell).toHaveFocus()
      expect(cell).toHaveAttribute('tabindex', '0')
    })

    it('returns focus to the programme cell when the Close button closes it', () => {
      render(<Guide />)
      const cell = screen.getByRole('button', { name: 'Test Movie cell' })
      cell.focus()
      fireEvent.click(cell)
      tick()

      fireEvent.click(
        screen.getAllByRole('button', { name: /close/i }).find((btn) => btn.getAttribute('data-slot') === 'dialog-close')!
      )
      tick()

      expect(cell).toHaveFocus()
    })
  })

  it('closes modal on X button click', () => {
    const onOpenChange = vi.fn()
    render(<ProgrammeDetailsModal {...defaultProps} onOpenChange={onOpenChange} />)

    // The X button has data-slot="dialog-close" attribute
    const dialogCloseButton = screen
      .getAllByRole('button', { name: /close/i })
      .find((btn) => btn.getAttribute('data-slot') === 'dialog-close')

    expect(dialogCloseButton).toBeDefined()
    fireEvent.click(dialogCloseButton!)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
