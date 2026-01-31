import { describe, it, expect } from 'vitest'
import { render, screen } from '@/test/utils'
import { ChannelInfoOverlay } from './ChannelInfoOverlay'

describe('ChannelInfoOverlay', () => {
  it('displays channel number and name', () => {
    render(
      <ChannelInfoOverlay
        channelNumber={5}
        channelName="ESPN"
        fadeState="none"
      />
    )

    expect(screen.getByText('05')).toBeInTheDocument()
    expect(screen.getByText('ESPN')).toBeInTheDocument()
  })

  it('formats numeric channel number with leading zeros', () => {
    render(
      <ChannelInfoOverlay
        channelNumber={7}
        channelName="HBO"
        fadeState="none"
      />
    )

    // Should display "07" not "7"
    expect(screen.getByText('07')).toBeInTheDocument()
  })

  it('formats string channel number with leading zeros', () => {
    render(
      <ChannelInfoOverlay
        channelNumber="5"
        channelName="CNN"
        fadeState="none"
      />
    )

    expect(screen.getByText('05')).toBeInTheDocument()
  })

  it('preserves longer channel numbers', () => {
    render(
      <ChannelInfoOverlay
        channelNumber={123}
        channelName="Channel"
        fadeState="none"
      />
    )

    // Should display "123" (3 digits, no padding needed beyond 2)
    expect(screen.getByText('123')).toBeInTheDocument()
  })

  it('applies fade-in animation class when fadeState is "in"', () => {
    const { container } = render(
      <ChannelInfoOverlay
        channelNumber={5}
        channelName="ESPN"
        fadeState="in"
      />
    )

    const overlay = container.firstChild as HTMLElement
    expect(overlay.className).toContain('animate-overlay-fade-in')
  })

  it('applies fade-out animation class when fadeState is "out"', () => {
    const { container } = render(
      <ChannelInfoOverlay
        channelNumber={5}
        channelName="ESPN"
        fadeState="out"
      />
    )

    const overlay = container.firstChild as HTMLElement
    expect(overlay.className).toContain('animate-overlay-fade-out')
  })

  it('has no animation class when fadeState is "none"', () => {
    const { container } = render(
      <ChannelInfoOverlay
        channelNumber={5}
        channelName="ESPN"
        fadeState="none"
      />
    )

    const overlay = container.firstChild as HTMLElement
    expect(overlay.className).not.toContain('animate-overlay-fade')
  })

  it('has phosphor glow styling', () => {
    const { container } = render(
      <ChannelInfoOverlay
        channelNumber={5}
        channelName="ESPN"
        fadeState="none"
      />
    )

    const glowElements = container.querySelectorAll('.text-phosphor-glow')
    expect(glowElements.length).toBe(2) // Number and name
  })

  it('has phosphor glow pulse animation on channel number', () => {
    const { container } = render(
      <ChannelInfoOverlay
        channelNumber={5}
        channelName="ESPN"
        fadeState="none"
      />
    )

    const pulseElement = container.querySelector('.animate-phosphor-glow-pulse')
    expect(pulseElement).toBeInTheDocument()
  })

  it('has pointer-events-none to not block interaction', () => {
    const { container } = render(
      <ChannelInfoOverlay
        channelNumber={5}
        channelName="ESPN"
        fadeState="none"
      />
    )

    const overlay = container.firstChild as HTMLElement
    expect(overlay.className).toContain('pointer-events-none')
  })

  it('is positioned in bottom-left corner', () => {
    const { container } = render(
      <ChannelInfoOverlay
        channelNumber={5}
        channelName="ESPN"
        fadeState="none"
      />
    )

    const overlay = container.firstChild as HTMLElement
    expect(overlay.className).toContain('bottom-8')
    expect(overlay.className).toContain('left-8')
  })

  it('has will-change-opacity for performance', () => {
    const { container } = render(
      <ChannelInfoOverlay
        channelNumber={5}
        channelName="ESPN"
        fadeState="none"
      />
    )

    const overlay = container.firstChild as HTMLElement
    expect(overlay.className).toContain('will-change-opacity')
  })

  it('handles empty channel name gracefully', () => {
    const { container } = render(
      <ChannelInfoOverlay
        channelNumber={5}
        channelName=""
        fadeState="none"
      />
    )

    // Should still render channel number
    expect(container.querySelector('.text-phosphor-glow')).toBeInTheDocument()
    // Channel number should be formatted
    expect(container.textContent).toContain('05')
  })

  it('handles channel number 0 (Live TV)', () => {
    render(
      <ChannelInfoOverlay
        channelNumber={0}
        channelName="Live TV"
        fadeState="none"
      />
    )

    // Should display "00" for channel 0
    expect(screen.getByText('00')).toBeInTheDocument()
    expect(screen.getByText('Live TV')).toBeInTheDocument()
  })
})
