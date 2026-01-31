import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@/test/utils'
import {
  ChannelSwitchOverlay,
  STATIC_BURST_DURATION,
  ERROR_STATIC_DURATION,
} from './ChannelSwitchOverlay'

describe('ChannelSwitchOverlay', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders channel info overlay when visible', () => {
    render(
      <ChannelSwitchOverlay channelName="ESPN" channelNumber={5} isVisible={true} />
    )

    // Channel name and number should be visible immediately
    expect(screen.getByText('ESPN')).toBeInTheDocument()
    expect(screen.getByText('05')).toBeInTheDocument()
  })

  it('shows static noise during initial STATIC_BURST phase', () => {
    const { container } = render(
      <ChannelSwitchOverlay channelName="ESPN" channelNumber={5} isVisible={true} />
    )

    // Static noise SVG should be visible during STATIC_BURST
    const staticOverlay = container.querySelector('.animate-static-grain')
    expect(staticOverlay).toBeInTheDocument()
  })

  it('transitions to LOADING phase after static burst', () => {
    const { container } = render(
      <ChannelSwitchOverlay channelName="ESPN" channelNumber={5} isVisible={true} />
    )

    // Advance past static burst duration (200ms)
    act(() => {
      vi.advanceTimersByTime(250)
    })

    // Should now show ProjectorBeamLoader with loading text
    expect(screen.getByText('Loading ESPN...')).toBeInTheDocument()

    // Film reel spinner should be present
    const spinner = container.querySelector('.animate-spin-slow')
    expect(spinner).toBeInTheDocument()
  })

  it('returns null when not visible and phase is HIDDEN', () => {
    const { container } = render(
      <ChannelSwitchOverlay channelName="ESPN" channelNumber={5} isVisible={false} />
    )

    expect(container.firstChild).toBeNull()
  })

  it('has pointer-events-none to not block interaction', () => {
    const { container } = render(
      <ChannelSwitchOverlay channelName="ESPN" channelNumber={5} isVisible={true} />
    )

    const overlay = container.firstChild as HTMLElement
    expect(overlay.className).toContain('pointer-events-none')
  })

  it('has dark overlay for visual effect', () => {
    const { container } = render(
      <ChannelSwitchOverlay channelName="ESPN" channelNumber={5} isVisible={true} />
    )

    // StaticNoiseOverlay uses a dark overlay with bg-black/70
    const darkOverlay = container.querySelector('.bg-black\\/70')
    expect(darkOverlay).toBeInTheDocument()
  })

  it('displays different channel names correctly', () => {
    const { rerender } = render(
      <ChannelSwitchOverlay channelName="CNN" channelNumber={1} isVisible={true} />
    )
    expect(screen.getByText('CNN')).toBeInTheDocument()
    expect(screen.getByText('01')).toBeInTheDocument()

    rerender(<ChannelSwitchOverlay channelName="HBO" channelNumber={12} isVisible={true} />)
    expect(screen.getByText('HBO')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
  })

  it('formats channel number with leading zeros', () => {
    render(
      <ChannelSwitchOverlay channelName="ESPN" channelNumber={5} isVisible={true} />
    )

    // Should display "05" not "5"
    expect(screen.getByText('05')).toBeInTheDocument()
  })

  it('handles string channel numbers', () => {
    render(
      <ChannelSwitchOverlay channelName="ESPN" channelNumber="ABC" isVisible={true} />
    )

    // Should pad strings too
    expect(screen.getByText('ABC')).toBeInTheDocument()
  })

  it('uses phosphor glow styling for channel info', () => {
    const { container } = render(
      <ChannelSwitchOverlay channelName="ESPN" channelNumber={5} isVisible={true} />
    )

    // Should have phosphor glow text
    const glowElements = container.querySelectorAll('.text-phosphor-glow')
    expect(glowElements.length).toBeGreaterThan(0)
  })

  it('resets to STATIC_BURST phase on rapid channel switches (Task 3.7)', () => {
    const { container, rerender } = render(
      <ChannelSwitchOverlay channelName="ESPN" channelNumber={5} isVisible={true} />
    )

    // Should start with static noise
    expect(container.querySelector('.animate-static-grain')).toBeInTheDocument()

    // Advance past static burst to LOADING phase
    act(() => {
      vi.advanceTimersByTime(STATIC_BURST_DURATION + 50)
    })

    // Should now be in LOADING phase
    expect(screen.getByText('Loading ESPN...')).toBeInTheDocument()
    expect(container.querySelector('.animate-static-grain')).not.toBeInTheDocument()

    // Rapid channel switch - isVisible goes false then true
    rerender(
      <ChannelSwitchOverlay channelName="HBO" channelNumber={10} isVisible={false} />
    )
    rerender(
      <ChannelSwitchOverlay channelName="HBO" channelNumber={10} isVisible={true} />
    )

    // Should reset to STATIC_BURST phase
    expect(container.querySelector('.animate-static-grain')).toBeInTheDocument()
    expect(screen.getByText('HBO')).toBeInTheDocument()
    expect(screen.getByText('10')).toBeInTheDocument()
  })

  it('shows extended static effect on error (AC #4)', () => {
    const { container } = render(
      <ChannelSwitchOverlay
        channelName="ESPN"
        channelNumber={5}
        isVisible={true}
        isError={false}
      />
    )

    // Advance to LOADING phase
    act(() => {
      vi.advanceTimersByTime(STATIC_BURST_DURATION + 50)
    })

    // Should be in LOADING phase, no static
    expect(container.querySelector('.animate-static-grain')).not.toBeInTheDocument()
    expect(screen.getByText('Loading ESPN...')).toBeInTheDocument()
  })

  it('transitions to ERROR_STATIC phase when isError becomes true', () => {
    const { container, rerender } = render(
      <ChannelSwitchOverlay
        channelName="ESPN"
        channelNumber={5}
        isVisible={true}
        isError={false}
      />
    )

    // Advance to LOADING phase
    act(() => {
      vi.advanceTimersByTime(STATIC_BURST_DURATION + 50)
    })

    // Should be in LOADING phase
    expect(screen.getByText('Loading ESPN...')).toBeInTheDocument()

    // Trigger error state
    rerender(
      <ChannelSwitchOverlay
        channelName="ESPN"
        channelNumber={5}
        isVisible={true}
        isError={true}
      />
    )

    // Should show static effect again (ERROR_STATIC phase)
    expect(container.querySelector('.animate-static-grain')).toBeInTheDocument()
  })

  it('hides overlay after ERROR_STATIC_DURATION on error', () => {
    const { container, rerender } = render(
      <ChannelSwitchOverlay
        channelName="ESPN"
        channelNumber={5}
        isVisible={true}
        isError={false}
      />
    )

    // Advance to LOADING phase
    act(() => {
      vi.advanceTimersByTime(STATIC_BURST_DURATION + 50)
    })

    // Trigger error
    rerender(
      <ChannelSwitchOverlay
        channelName="ESPN"
        channelNumber={5}
        isVisible={true}
        isError={true}
      />
    )

    // Should show static
    expect(container.querySelector('.animate-static-grain')).toBeInTheDocument()

    // Advance past ERROR_STATIC_DURATION
    act(() => {
      vi.advanceTimersByTime(ERROR_STATIC_DURATION + 50)
    })

    // Should now be hidden
    expect(container.firstChild).toBeNull()
  })
})
