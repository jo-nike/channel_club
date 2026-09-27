import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LivePill } from './LivePill'

describe('LivePill', () => {
  it('is a solid live-token pill in the display face, uppercase and letter-spaced', () => {
    render(<LivePill />)

    const pill = screen.getByText('Live')
    expect(pill).toBe(screen.getByTestId('live-pill'))
    expect(pill).toHaveClass('bg-live', 'text-live-foreground', 'rounded')
    expect(pill).toHaveClass('font-display', 'font-extrabold', 'text-[11px]', 'uppercase', 'tracking-[0.12em]')
    expect(pill.className).not.toMatch(/destructive/)
  })

  it('leads with a decorative dot in the pill text colour', () => {
    render(<LivePill />)

    const dot = screen.getByTestId('live-pill').firstElementChild
    expect(dot).toHaveAttribute('aria-hidden', 'true')
    expect(dot).toHaveClass('rounded-full', 'bg-live-foreground')
    expect(dot).toBeEmptyDOMElement()
  })

  it('takes placement classes without changing its look', () => {
    render(<LivePill className="mr-1.5 align-middle" />)

    expect(screen.getByTestId('live-pill')).toHaveClass('mr-1.5', 'align-middle', 'bg-live', 'text-[11px]')
  })
})
