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
          isVisible={true}
          highlightStatus={defaultStatus}
          loaded
        />
      )

      const button = screen.getByRole('button')
      expect(button).toBeInTheDocument()
    })

    it('has correct accessibility attributes', () => {
      render(
        <HighlightButton
          isVisible={true}
          highlightStatus={defaultStatus}
          loaded
        />
      )

      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('aria-label')
      expect(button).toHaveAttribute('type', 'button')
    })

    it('is tabbable when visible and recording', () => {
      render(
        <HighlightButton
          isVisible={true}
          highlightStatus={defaultStatus}
          loaded
        />
      )

      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('tabindex', '0')
    })

    it('is not tabbable when not visible', () => {
      render(
        <HighlightButton
          isVisible={false}
          highlightStatus={defaultStatus}
          loaded
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
          isVisible={true}
          highlightStatus={defaultStatus}
          loaded
          onOpenModal={onOpenModal}
        />
      )

      fireEvent.click(screen.getByRole('button'))
      expect(onOpenModal).toHaveBeenCalled()
    })

    it('does nothing if onOpenModal is not provided', () => {
      render(
        <HighlightButton
          isVisible={true}
          highlightStatus={defaultStatus}
          loaded
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
          isVisible={true}
          highlightStatus={notRecordingStatus}
          loaded
        />
      )

      // Kept in place, disabled: recording:false is brief right after a tune
      expect(screen.getByRole('button')).toBeDisabled()
      expect(screen.getByRole('button')).toHaveAccessibleName('Clip unavailable')
    })
  })

  it('waits for a completed segment even when an incomplete buffer has seconds', () => {
    render(<HighlightButton isVisible loaded highlightStatus={{ ...defaultStatus, ready: false }} />)
    expect(screen.getByRole('button')).toBeDisabled()
    expect(screen.getByRole('button')).toHaveAccessibleName('Buffering clip · 30s of 60s')
  })

  describe('States without a text label', () => {
    const notRecording: HighlightStatusResponse = { ...defaultStatus, recording: false, bufferSeconds: 0 }
    const buffering: HighlightStatusResponse = { ...defaultStatus, ready: false, bufferSeconds: 12 }
    const ready: HighlightStatusResponse = { ...defaultStatus, ready: true, bufferSeconds: 45 }
    const states: [string, HighlightStatusResponse, boolean][] = [
      ['checking', defaultStatus, false],
      ['unavailable', notRecording, true],
      ['buffering', buffering, true],
      ['ready', ready, true],
    ]

    const renderState = (status: HighlightStatusResponse, loaded: boolean) =>
      render(<HighlightButton isVisible loaded={loaded} highlightStatus={status} />)

    it.each(states)('shows no text in the %s state; the label and tooltip carry it', async (state, status, loaded) => {
      renderState(status, loaded)

      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('data-state', state)
      expect(button.textContent).toBe('')
      fireEvent.focus(button)
      expect(await screen.findByRole('tooltip')).toHaveTextContent(button.getAttribute('aria-label') ?? '')
    })

    it('keeps the same fixed-width classes in every state, so its neighbours never shift', () => {
      const classNames = states.map(([, status, loaded]) => {
        const { unmount } = renderState(status, loaded)
        const className = screen.getByRole('button').className
        unmount()
        return className
      })

      expect(new Set(classNames).size).toBe(1)
      expect(classNames[0]).toContain('w-12')
      expect(classNames[0]).toContain('shrink-0')
    })

    it('names the readiness and seconds', () => {
      renderState(ready, true)
      expect(screen.getByRole('button')).toHaveAccessibleName('Capture clip · 45s available')
      expect(screen.getByRole('button')).toBeEnabled()
    })

    it('shows a neutral checking ring, not Clip unavailable, before the first poll answers', () => {
      const { container } = renderState(defaultStatus, false)

      const button = screen.getByRole('button')
      expect(button).toHaveAccessibleName('Checking clip…')
      expect(button).toBeDisabled()
      // The track only: no progress arc yet
      expect(container.querySelector('svg circle')).toBeInTheDocument()
      expect(container.querySelector('[data-ring="progress"]')).toBeNull()
    })
  })

  describe('Buffer ring', () => {
    const progress = (container: HTMLElement) => {
      const arc = container.querySelector('[data-ring="progress"]')
      if (!arc) throw new Error('no progress arc')
      const length = Number(arc.getAttribute('stroke-dasharray'))
      const offset = Number(arc.getAttribute('stroke-dashoffset'))
      return { arc, filled: 1 - offset / length }
    }

    it('fills as far as the buffer is from full', () => {
      const { container } = render(
        <HighlightButton isVisible loaded highlightStatus={{ ...defaultStatus, ready: false, bufferSeconds: 15 }} />
      )

      expect(progress(container).filled).toBeCloseTo(0.25)
    })

    it('follows the buffer as it grows', () => {
      const { container, rerender } = render(
        <HighlightButton isVisible loaded highlightStatus={{ ...defaultStatus, bufferSeconds: 30 }} />
      )
      expect(progress(container).filled).toBeCloseTo(0.5)

      rerender(<HighlightButton isVisible loaded highlightStatus={{ ...defaultStatus, bufferSeconds: 60 }} />)
      expect(progress(container).filled).toBeCloseTo(1)
    })

    it('never overfills or goes negative', () => {
      const { container, rerender } = render(
        <HighlightButton isVisible loaded highlightStatus={{ ...defaultStatus, bufferSeconds: 90 }} />
      )
      expect(progress(container).filled).toBeCloseTo(1)

      rerender(<HighlightButton isVisible loaded highlightStatus={{ ...defaultStatus, ready: false, bufferSeconds: 0, maxBufferSeconds: 0 }} />)
      expect(progress(container).filled).toBeCloseTo(0)
    })

    it('turns primary when a clip is ready and stays white while buffering', () => {
      const { container, rerender } = render(
        <HighlightButton isVisible loaded highlightStatus={{ ...defaultStatus, ready: false }} />
      )
      expect(progress(container).arc).toHaveClass('stroke-white')
      expect(progress(container).arc).not.toHaveClass('stroke-primary')

      rerender(<HighlightButton isVisible loaded highlightStatus={{ ...defaultStatus, ready: true }} />)
      expect(progress(container).arc).toHaveClass('stroke-primary')
    })

    it('has no progress arc when the channel is not recording', () => {
      const { container } = render(
        <HighlightButton isVisible loaded highlightStatus={{ ...defaultStatus, recording: false }} />
      )

      expect(container.querySelector('[data-ring="progress"]')).toBeNull()
    })
  })

  describe('Compact (phone landscape)', () => {
    const notRecording: HighlightStatusResponse = { ...defaultStatus, recording: false, bufferSeconds: 0 }

    it('leaves the button out while the channel is not recording', () => {
      render(<HighlightButton isVisible loaded highlightStatus={notRecording} compact />)

      expect(screen.queryByRole('button')).not.toBeInTheDocument()
      expect(screen.queryByText('Clip unavailable')).not.toBeInTheDocument()
    })

    it('keeps the disabled, named button when not compact', () => {
      render(<HighlightButton isVisible loaded highlightStatus={notRecording} />)

      expect(screen.getByRole('button', { name: 'Clip unavailable' })).toBeDisabled()
    })

    it.each([
      ['checking', defaultStatus, false],
      ['buffering', { ...defaultStatus, ready: false, bufferSeconds: 12 }, true],
      ['ready', { ...defaultStatus, ready: true }, true],
    ] as [string, HighlightStatusResponse, boolean][])(
      'shows the %s state as a 44px icon with no text',
      (state, status, loaded) => {
        render(<HighlightButton isVisible loaded={loaded} highlightStatus={status} compact />)

        const button = screen.getByRole('button')
        expect(button).toHaveAttribute('data-state', state)
        expect(button.textContent).toBe('')
        expect(button).toHaveClass('h-11', 'w-11', 'min-h-[44px]', 'min-w-[44px]', 'shrink-0')
        expect(button).not.toHaveClass('w-12')
      }
    )

    it('still opens the editor when a clip is ready', () => {
      const onOpenModal = vi.fn()
      render(
        <HighlightButton
          isVisible
          loaded
          highlightStatus={{ ...defaultStatus, ready: true }}
          onOpenModal={onOpenModal}
          compact
        />
      )

      fireEvent.click(screen.getByRole('button', { name: 'Capture clip · 30s available' }))
      expect(onOpenModal).toHaveBeenCalledTimes(1)
    })
  })

  describe('Styling', () => {
    it('has control button styling', () => {
      render(
        <HighlightButton
          isVisible={true}
          highlightStatus={defaultStatus}
          loaded
        />
      )

      const button = screen.getByRole('button')
      expect(button).toHaveClass('control-button')
    })

    it('has minimum touch target size', () => {
      render(
        <HighlightButton
          isVisible={true}
          highlightStatus={defaultStatus}
          loaded
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
          isVisible={true}
          highlightStatus={defaultStatus}
          loaded
        />
      )

      const button = screen.getByRole('button')
      expect(button).toHaveClass('focus-ring-media')
      expect(focusOverrides(button)).toEqual([])
    })
  })
})
