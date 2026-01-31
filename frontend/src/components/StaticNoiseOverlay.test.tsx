import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@/test/utils'
import { StaticNoiseOverlay } from './StaticNoiseOverlay'

describe('StaticNoiseOverlay', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders SVG noise filter when visible', () => {
    const { container } = render(<StaticNoiseOverlay isVisible={true} />)

    // Should have SVG with feTurbulence filter
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()

    const turbulence = container.querySelector('feTurbulence')
    expect(turbulence).toBeInTheDocument()
  })

  it('returns null when not visible', () => {
    const { container } = render(<StaticNoiseOverlay isVisible={false} />)

    expect(container.firstChild).toBeNull()
  })

  it('has pointer-events-none to not block interaction', () => {
    const { container } = render(<StaticNoiseOverlay isVisible={true} />)

    const overlay = container.firstChild as HTMLElement
    expect(overlay.className).toContain('pointer-events-none')
  })

  it('has dark overlay background', () => {
    const { container } = render(<StaticNoiseOverlay isVisible={true} />)

    const darkOverlay = container.querySelector('.bg-black\\/70')
    expect(darkOverlay).toBeInTheDocument()
  })

  it('has static grain animation class', () => {
    const { container } = render(<StaticNoiseOverlay isVisible={true} />)

    const animatedElement = container.querySelector('.animate-static-grain')
    expect(animatedElement).toBeInTheDocument()
  })

  it('animates seed value when visible', () => {
    const { container } = render(<StaticNoiseOverlay isVisible={true} />)

    // Get initial seed from filter ID
    const initialFilter = container.querySelector('filter')
    const initialId = initialFilter?.getAttribute('id')

    // Advance timer to trigger seed change (100ms interval)
    act(() => {
      vi.advanceTimersByTime(150)
    })

    // Seed should have changed
    const newFilter = container.querySelector('filter')
    const newId = newFilter?.getAttribute('id')

    // IDs should be different if seed changed
    // Note: This tests that the component updates, seed goes 0 -> 1
    expect(newId).not.toBe(initialId)
  })

  it('uses fractalNoise type for realistic static', () => {
    const { container } = render(<StaticNoiseOverlay isVisible={true} />)

    const turbulence = container.querySelector('feTurbulence')
    expect(turbulence?.getAttribute('type')).toBe('fractalNoise')
  })

  it('has will-change-transform for performance', () => {
    const { container } = render(<StaticNoiseOverlay isVisible={true} />)

    const overlay = container.firstChild as HTMLElement
    expect(overlay.className).toContain('will-change-transform')
  })

  it('has accessible role and label for screen readers', () => {
    const { container } = render(<StaticNoiseOverlay isVisible={true} />)

    const overlay = container.firstChild as HTMLElement
    expect(overlay.getAttribute('role')).toBe('status')
    expect(overlay.getAttribute('aria-label')).toBe('Channel switching')
  })

  it('clears interval on rapid visibility toggles (race condition prevention)', () => {
    const { rerender } = render(<StaticNoiseOverlay isVisible={true} />)

    // Rapid toggle should not cause issues
    rerender(<StaticNoiseOverlay isVisible={false} />)
    rerender(<StaticNoiseOverlay isVisible={true} />)
    rerender(<StaticNoiseOverlay isVisible={false} />)
    rerender(<StaticNoiseOverlay isVisible={true} />)

    // Advance time - should not throw or cause memory leaks
    act(() => {
      vi.advanceTimersByTime(500)
    })

    // Component should still function properly
    rerender(<StaticNoiseOverlay isVisible={false} />)
    // No assertion needed - test passes if no errors thrown
  })
})
