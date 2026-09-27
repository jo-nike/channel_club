import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { ZapBanner } from './ZapBanner'
import type { LiveChannelChange } from '@/stores/channelStore'
import type { UnifiedChannel } from '@/types'

const liveSlot = (name: string): UnifiedChannel => ({
  id: 'live-channel-0',
  name,
  number: 0,
  streamUrl: `https://fixture/${name}`,
  type: 'live',
})
const change = (channelName: string, by: string | null, at: number): LiveChannelChange => ({ channelName, by, at })

const banner = () => screen.getByRole('status')
const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms)
  })

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ZapBanner: legibility', () => {
  it('gives every line a text shadow over a deeper scrim, so the hint reads over bright pictures', () => {
    render(<ZapBanner channel={liveSlot('Sports')} />)

    const card = screen.getByText(/change channel/).parentElement
    expect(card).toHaveClass('bg-black/80', 'text-shadow-lg', 'text-shadow-black/60')
    expect(card).not.toHaveClass('bg-black/70')
  })
})

describe('ZapBanner: live changes in TV theater', () => {
  it('names who changed the live channel, in the toast\'s words, in the announced banner', () => {
    const { rerender } = render(<ZapBanner channel={liveSlot('TSN 5')} />)
    advance(3000)
    expect(banner()).toBeEmptyDOMElement()

    rerender(<ZapBanner channel={liveSlot('Sportsnet One')} liveChange={change('Sportsnet One', 'jon', 1)} />)

    expect(banner()).toHaveTextContent('CH 0 · Sportsnet One')
    expect(banner()).toHaveTextContent('jon put on Sportsnet One')
  })

  it('says the live channel was set when nobody is named', () => {
    render(<ZapBanner channel={liveSlot('TSN 3')} liveChange={change('TSN 3', null, 1)} />)

    expect(banner()).toHaveTextContent('Live channel set to TSN 3')
  })

  it('comes back for a change to the same channel name, and the announcement ending does not bring it back', () => {
    const { rerender } = render(<ZapBanner channel={liveSlot('TSN 5')} liveChange={change('TSN 5', 'jon', 1)} />)
    advance(3000)
    expect(banner()).toBeEmptyDOMElement()

    // Put on again by someone else: the name is the same, the change is new
    rerender(<ZapBanner channel={liveSlot('TSN 5')} liveChange={change('TSN 5', 'dev', 2)} />)
    expect(banner()).toHaveTextContent('dev put on TSN 5')

    advance(3000)
    rerender(<ZapBanner channel={liveSlot('TSN 5')} liveChange={null} />)
    expect(banner()).toBeEmptyDOMElement()
  })

  it('shows just the channel with no change to announce', () => {
    render(<ZapBanner channel={liveSlot('TSN 5')} />)

    expect(banner()).toHaveTextContent('CH 0 · TSN 5')
    expect(banner()).not.toHaveTextContent(/put on|set to/)
  })
})
