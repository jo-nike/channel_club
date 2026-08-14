import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { RetroTVFilter } from './RetroTVFilter'

describe('RetroTVFilter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should render nothing when isActive is false', () => {
    const { container } = render(<RetroTVFilter isActive={false} />)
    expect(container.firstChild).toBeNull()
  })

  it('should render filter overlay when isActive is true', () => {
    const { container } = render(<RetroTVFilter isActive={true} />)
    expect(container.querySelector('.retro-tv-filter')).toBeInTheDocument()
  })

  it('should have pointer-events-none for non-interactive overlay', () => {
    const { container } = render(<RetroTVFilter isActive={true} />)
    const overlay = container.querySelector('.retro-tv-filter')
    expect(overlay).toHaveClass('pointer-events-none')
  })

  it('should include scanlines layer', () => {
    const { container } = render(<RetroTVFilter isActive={true} />)
    const scanlines = container.querySelector('.bg-scanlines')
    expect(scanlines).toBeInTheDocument()
  })

  it('should include vignette layer', () => {
    const { container } = render(<RetroTVFilter isActive={true} />)
    const vignette = container.querySelector('.bg-vignette')
    expect(vignette).toBeInTheDocument()
  })

  it('should include chromatic aberration layer', () => {
    const { container } = render(<RetroTVFilter isActive={true} />)
    const chromatic = container.querySelector('.chromatic-aberration')
    expect(chromatic).toBeInTheDocument()
  })

  it('should include static noise SVG', () => {
    const { container } = render(<RetroTVFilter isActive={true} />)
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
  })

  it('should have aria-hidden for accessibility', () => {
    const { container } = render(<RetroTVFilter isActive={true} />)
    const overlay = container.querySelector('.retro-tv-filter')
    expect(overlay).toHaveAttribute('aria-hidden', 'true')
  })

  it('should have z-10 for proper layering', () => {
    const { container } = render(<RetroTVFilter isActive={true} />)
    const overlay = container.querySelector('.retro-tv-filter')
    expect(overlay).toHaveClass('z-10')
  })
})
