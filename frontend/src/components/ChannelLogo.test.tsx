import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChannelLogo } from './ChannelLogo'

const slot = () => screen.getByTestId('channel-logo')

describe('ChannelLogo', () => {
  it('shows the fallback in place of the monogram when there is no logo', () => {
    render(<ChannelLogo channel={{ name: 'Live' }} fallback={<svg data-testid="icon" />} />)

    expect(slot().querySelector('img')).toBeNull()
    expect(slot().querySelector('[data-monogram]')).toBeNull()
    expect(screen.getByTestId('icon').parentElement).toBe(slot())
  })

  it('shows the fallback when the logo fails to load', () => {
    render(
      <ChannelLogo
        channel={{ name: 'TSN 5', logoUrl: '/api/channels/logos/17' }}
        fallback={<svg data-testid="icon" />}
      />
    )
    expect(screen.queryByTestId('icon')).toBeNull()

    fireEvent.error(slot().querySelector('img')!)

    expect(slot().querySelector('img')).toBeNull()
    expect(screen.getByTestId('icon')).toBeInTheDocument()
  })

  it('shows the logo over the fallback when there is one', () => {
    render(
      <ChannelLogo
        channel={{ name: 'TSN 5', logoUrl: '/api/channels/logos/17' }}
        fallback={<svg data-testid="icon" />}
      />
    )

    expect(slot().querySelector('img')).toHaveAttribute('src', '/api/channels/logos/17')
    expect(screen.queryByTestId('icon')).toBeNull()
  })

  it('shows the monogram when there is no logo and no fallback', () => {
    render(<ChannelLogo channel={{ name: 'Sportsnet One' }} />)

    expect(slot().querySelector('[data-monogram]')).toHaveAttribute('data-monogram', 'SO')
  })

  it("takes a surface's size and background in place of its own", () => {
    render(<ChannelLogo channel={{ name: 'Movies' }} className="size-12 rounded bg-live/20" />)

    expect(slot()).toHaveClass('size-12', 'rounded', 'bg-live/20')
    expect(slot()).not.toHaveClass('size-10', 'rounded-lg', 'bg-muted')
  })
})
