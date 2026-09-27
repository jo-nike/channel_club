import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@/test/utils'
import { HighlightButton } from './HighlightButton'
import { focusOverrides } from '@/test/focus'
import type { HighlightStatusResponse } from '@/services/api'

const defaultStatus: HighlightStatusResponse = {
  enabled: true,
  recording: true,
  bufferSeconds: 30,
  maxBufferSeconds: 60,
}

describe('HighlightButton', () => {
  describe('Rendering', () => {
    it('renders the button with icon when recording', () => {
      render(
        <HighlightButton
          channelId="channel-1"
          isVisible={true}
          highlightStatus={defaultStatus}
        />
      )

      const button = screen.getByRole('button')
      expect(button).toBeInTheDocument()
    })

    it('has correct accessibility attributes', () => {
      render(
        <HighlightButton
          channelId="channel-1"
          isVisible={true}
          highlightStatus={defaultStatus}
        />
      )

      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('aria-label')
      expect(button).toHaveAttribute('type', 'button')
    })

    it('is tabbable when visible and recording', () => {
      render(
        <HighlightButton
          channelId="channel-1"
          isVisible={true}
          highlightStatus={defaultStatus}
        />
      )

      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('tabindex', '0')
    })

    it('is not tabbable when not visible', () => {
      render(
        <HighlightButton
          channelId="channel-1"
          isVisible={false}
          highlightStatus={defaultStatus}
        />
      )

      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('tabindex', '-1')
    })
  })

  describe('Modal Opening', () => {
    it('calls onOpenModal when clicked', () => {
      const onOpenModal = vi.fn()
      render(
        <HighlightButton
          channelId="channel-1"
          isVisible={true}
          highlightStatus={defaultStatus}
          onOpenModal={onOpenModal}
        />
      )

      fireEvent.click(screen.getByRole('button'))
      expect(onOpenModal).toHaveBeenCalled()
    })

    it('does nothing if onOpenModal is not provided', () => {
      render(
        <HighlightButton
          channelId="channel-1"
          isVisible={true}
          highlightStatus={defaultStatus}
        />
      )

      // Should not throw
      fireEvent.click(screen.getByRole('button'))
    })
  })

  describe('Hidden State', () => {
    it('is unavailable when not recording', () => {
      const notRecordingStatus: HighlightStatusResponse = {
        enabled: true,
        recording: false,
        bufferSeconds: 0,
        maxBufferSeconds: 60,
      }

      render(
        <HighlightButton
          channelId="channel-1"
          isVisible={true}
          highlightStatus={notRecordingStatus}
        />
      )

      // Button should not be in the document when not recording
      expect(screen.getByRole('button')).toBeDisabled()
      expect(screen.getByRole('button')).toHaveAccessibleName('Clip unavailable')
    })
  })

  it('waits for a completed segment even when an incomplete buffer has seconds', () => {
    render(<HighlightButton channelId="channel-1" isVisible highlightStatus={{ ...defaultStatus, ready: false }} />)
    expect(screen.getByRole('button')).toBeDisabled()
    expect(screen.getByRole('button')).toHaveAccessibleName('Buffering clip…')
  })

  describe('Styling', () => {
    it('has control button styling', () => {
      render(
        <HighlightButton
          channelId="channel-1"
          isVisible={true}
          highlightStatus={defaultStatus}
        />
      )

      const button = screen.getByRole('button')
      expect(button).toHaveClass('control-button')
    })

    it('has minimum touch target size', () => {
      render(
        <HighlightButton
          channelId="channel-1"
          isVisible={true}
          highlightStatus={defaultStatus}
        />
      )

      const button = screen.getByRole('button')
      expect(button).toHaveClass('min-h-[48px]')
      expect(button).toHaveClass('min-w-[48px]')
    })
  })

  describe('Focus', () => {
    it('marks keyboard focus with the over-video ring, not a blue ring', () => {
      render(
        <HighlightButton
          channelId="channel-1"
          isVisible={true}
          highlightStatus={defaultStatus}
        />
      )

      const button = screen.getByRole('button')
      expect(button).toHaveClass('focus-ring-media')
      expect(focusOverrides(button)).toEqual([])
    })
  })
})
