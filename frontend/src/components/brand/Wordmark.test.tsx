import { describe, it, expect } from 'vitest'
import { render, screen } from '@/test/utils'
import { Wordmark } from './Wordmark'

function dotOf(wordmark: HTMLElement) {
  return wordmark.querySelector('[data-slot="wordmark-dot"]')
}

describe('Wordmark', () => {
  it('is announced once as "Channel Club"', () => {
    render(<Wordmark />)
    expect(screen.getByRole('img', { name: 'Channel Club' })).toBeInTheDocument()
  })

  it('names a heading that wraps it', () => {
    render(
      <h1>
        <Wordmark size="lg" />
      </h1>
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Channel Club' })).toBeInTheDocument()
  })

  it('shows the name in the display face', () => {
    render(<Wordmark />)
    const wordmark = screen.getByRole('img', { name: 'Channel Club' })
    expect(wordmark).toHaveTextContent('Channel Club')
    expect(wordmark).toHaveClass('font-display', 'uppercase')
  })

  it('leads with an 8px round on-air dot in the live colour', () => {
    render(<Wordmark />)
    const dot = dotOf(screen.getByRole('img', { name: 'Channel Club' }))
    expect(dot).not.toBeNull()
    expect(dot).toHaveClass('size-2', 'rounded-full', 'bg-live')
    expect(dot?.parentElement?.firstElementChild).toBe(dot)
  })

  it.each([
    ['sm', 'text-base'],
    ['md', 'text-xl'],
    ['lg', 'text-4xl'],
  ] as const)('size %s sets the type to %s and keeps the 8px dot', (size, textClass) => {
    render(<Wordmark size={size} />)
    const wordmark = screen.getByRole('img', { name: 'Channel Club' })
    expect(wordmark).toHaveClass(textClass)
    expect(dotOf(wordmark)).toHaveClass('size-2')
  })

  it('defaults to the header size', () => {
    render(<Wordmark />)
    expect(screen.getByRole('img', { name: 'Channel Club' })).toHaveAttribute('data-size', 'md')
  })

  it('accepts extra classes from the caller', () => {
    render(<Wordmark className="text-primary" />)
    expect(screen.getByRole('img', { name: 'Channel Club' })).toHaveClass('text-primary')
  })
})
