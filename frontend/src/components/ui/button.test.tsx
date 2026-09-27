import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button } from './button'
import { focusOverrides } from '@/test/focus'

describe('Button toolbar variant', () => {
  it('is quiet by default and hovers onto the accent surface', () => {
    render(<Button variant="toolbar" aria-label="Guide" />)
    const button = screen.getByRole('button', { name: 'Guide' })
    expect(button).toHaveClass(
      'bg-transparent',
      'text-muted-foreground',
      'hover:bg-accent',
      'hover:text-foreground',
    )
  })

  it('shows a pressed toggle with a primary tint, not only a brighter icon', () => {
    render(<Button variant="toolbar" aria-label="Guide" aria-pressed />)
    const button = screen.getByRole('button', { name: 'Guide', pressed: true })
    expect(button).toHaveClass('aria-pressed:bg-primary/15', 'aria-pressed:text-foreground', 'aria-pressed:[&_svg]:text-primary')
  })

  it('relies on the global focus outline', () => {
    render(<Button variant="toolbar" size="toolbar" aria-label="Guide" />)
    expect(focusOverrides(screen.getByRole('button', { name: 'Guide' }))).toEqual([])
  })
})

describe('Button toolbar size', () => {
  it('is a 44px touch target on touch screens and phones, 36px for a mouse from md, with 18px icons', () => {
    render(<Button variant="toolbar" size="toolbar" aria-label="Guide" />)
    const button = screen.getByRole('button', { name: 'Guide' })
    expect(button).toHaveClass('size-11', 'pointer-fine:md:size-9', "[&_svg:not([class*='size-'])]:size-[18px]")
    // Keyed on the pointer, not width alone: a touch tablet at md keeps 44px
    expect(button).not.toHaveClass('md:size-9')
    // The base 16px icon rule is replaced, not stacked alongside
    expect(button).not.toHaveClass("[&_svg:not([class*='size-'])]:size-4")
  })
})
