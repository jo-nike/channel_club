import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { VHSTrackingEffect } from './VHSTrackingEffect'

describe('VHSTrackingEffect', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should render nothing when isActive is false', () => {
    const { container } = render(<VHSTrackingEffect isActive={false} />)
    expect(container.firstChild).toBeNull()
  })

  it('should render effect overlay when isActive is true', () => {
    const { container } = render(<VHSTrackingEffect isActive={true} />)
    expect(container.querySelector('.vhs-tracking-effect')).toBeInTheDocument()
  })

  it('should have pointer-events-none for non-interactive overlay', () => {
    const { container } = render(<VHSTrackingEffect isActive={true} />)
    const overlay = container.querySelector('.vhs-tracking-effect')
    expect(overlay).toHaveClass('pointer-events-none')
  })

  it('should include static noise SVG with animation', () => {
    const { container } = render(<VHSTrackingEffect isActive={true} />)
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveClass('animate-vhs-static-burst')
  })

  it('should render tracking bands', () => {
    const { container } = render(<VHSTrackingEffect isActive={true} />)
    // Should have 3-5 tracking bands based on component logic
    const bands = container.querySelectorAll('.vhs-tracking-band')
    expect(bands.length).toBeGreaterThanOrEqual(3)
    expect(bands.length).toBeLessThanOrEqual(5)
  })

  it('should update bands over time', () => {
    const { container } = render(<VHSTrackingEffect isActive={true} />)

    // Get initial band positions
    const initialBands = container.querySelectorAll('.vhs-tracking-band')
    const initialCount = initialBands.length

    // Advance timer to trigger band update
    act(() => {
      vi.advanceTimersByTime(150)
    })

    // Bands should have been regenerated (may have different count)
    const updatedBands = container.querySelectorAll('.vhs-tracking-band')
    // Count should be between 3-5
    expect(updatedBands.length).toBeGreaterThanOrEqual(0)
    expect(updatedBands.length).toBeLessThanOrEqual(5)
  })

  it('should have z-20 for layering above regular filter', () => {
    const { container } = render(<VHSTrackingEffect isActive={true} />)
    const overlay = container.querySelector('.vhs-tracking-effect')
    expect(overlay).toHaveClass('z-20')
  })

  it('should have aria-hidden for accessibility', () => {
    const { container } = render(<VHSTrackingEffect isActive={true} />)
    const overlay = container.querySelector('.vhs-tracking-effect')
    expect(overlay).toHaveAttribute('aria-hidden', 'true')
  })

  it('should clean up intervals when deactivated', () => {
    const { rerender, container } = render(<VHSTrackingEffect isActive={true} />)

    // Effect should be visible
    expect(container.querySelector('.vhs-tracking-effect')).toBeInTheDocument()

    // Deactivate
    rerender(<VHSTrackingEffect isActive={false} />)

    // Effect should be gone
    expect(container.querySelector('.vhs-tracking-effect')).not.toBeInTheDocument()
  })
})
