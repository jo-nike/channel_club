import { describe, it, expect } from 'vitest'
import { render, screen } from '@/test/utils'
import { ChannelSwitchOverlay } from './ChannelSwitchOverlay'

describe('ChannelSwitchOverlay', () => {
  it('renders channel name and spinner when visible', () => {
    const { container } = render(
      <ChannelSwitchOverlay channelName="ESPN" isVisible={true} />
    )

    expect(screen.getByText('Loading ESPN...')).toBeInTheDocument()

    // Check for film reel spinner element (animate-spin-slow from ProjectorBeamLoader)
    const spinner = container.querySelector('.animate-spin-slow')
    expect(spinner).toBeInTheDocument()
  })

  it('returns null when not visible', () => {
    const { container } = render(
      <ChannelSwitchOverlay channelName="ESPN" isVisible={false} />
    )

    expect(container.firstChild).toBeNull()
  })

  it('has pointer-events-none to not block interaction', () => {
    const { container } = render(
      <ChannelSwitchOverlay channelName="ESPN" isVisible={true} />
    )

    const overlay = container.firstChild as HTMLElement
    expect(overlay.className).toContain('pointer-events-none')
  })

  it('has dark overlay for visual effect', () => {
    const { container } = render(
      <ChannelSwitchOverlay channelName="ESPN" isVisible={true} />
    )

    // ProjectorBeamLoader uses a dark overlay with bg-black/70
    const darkOverlay = container.querySelector('.bg-black\\/70')
    expect(darkOverlay).toBeInTheDocument()
  })

  it('displays different channel names correctly', () => {
    const { rerender } = render(
      <ChannelSwitchOverlay channelName="CNN" isVisible={true} />
    )
    expect(screen.getByText('Loading CNN...')).toBeInTheDocument()

    rerender(<ChannelSwitchOverlay channelName="HBO" isVisible={true} />)
    expect(screen.getByText('Loading HBO...')).toBeInTheDocument()
  })
})
