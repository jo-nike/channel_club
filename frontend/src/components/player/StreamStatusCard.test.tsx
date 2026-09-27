import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@/test/utils'
import { StreamStatusCard } from './StreamStatusCard'
import { useChannelStore } from '@/stores/channelStore'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { LIVE_CHANNEL_ID, useTVStore } from '@/stores/tvStore'
import type { Channel, ErsatzTVChannel, UnifiedChannel } from '@/types'

// The TV store looks the live guide up when live TV changes; never answered here
vi.mock('@/services/api', () => ({
  fetchNowPlaying: vi.fn(() => new Promise(() => {})),
  fetchLiveProgrammes: vi.fn(() => new Promise(() => {})),
}))

const cartoons: ErsatzTVChannel = { id: 'e2', name: 'Cartoons', number: 2, streamUrl: '/e2', logoUrl: '', group: '' }
const tsn: Channel = { id: '28', name: 'TSN 5', streamUrl: 'http://x/28', guideId: '5' }
const movies: UnifiedChannel = { id: 'e3', name: 'Movies', number: 3, streamUrl: '/e3', type: 'ersatztv' }

const renderCard = (props: Partial<Parameters<typeof StreamStatusCard>[0]> = {}) => {
  const onRetry = vi.fn()
  render(<StreamStatusCard status="failed" attempt={5} maxAttempts={5} onRetry={onRetry} {...props} />)
  return { onRetry }
}

beforeEach(() => {
  useChannelStore.setState({ currentChannel: null })
  useErsatztvStore.setState({ channels: [cartoons] })
  useTVStore.setState({ selectedChannel: movies, previousChannelId: null })
})

describe('StreamStatusCard', () => {
  it.each(['loading', 'ready'] as const)('shows nothing while %s', (status) => {
    const { container } = render(<StreamStatusCard status={status} attempt={0} maxAttempts={5} onRetry={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('while reconnecting, is a pill with the attempt that lets taps through', () => {
    renderCard({ status: 'reconnecting', attempt: 2 })

    const pill = screen.getByRole('status')
    expect(pill).toHaveTextContent('Reconnecting... 2 of 5')
    expect(pill).toHaveClass('pointer-events-none')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('says it is starting the stream when nothing has played yet', () => {
    renderCard({ status: 'reconnecting', attempt: 1, isStarting: true })
    expect(screen.getByRole('status')).toHaveTextContent('Starting stream... 1 of 5')
  })

  it("when the reconnects stop, says so and offers Retry, without 'Select another channel'", () => {
    const { onRetry } = renderCard()

    expect(screen.getByRole('alert')).toHaveTextContent("Stream stopped")
    expect(screen.getByRole('alert')).toHaveTextContent("It didn't come back after 5 tries.")
    expect(screen.getByRole('region', { name: 'Stream stopped' })).toHaveClass('video-controls')
    expect(screen.queryByText(/Select another channel/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('offers Back to the channel this viewer was on before, and tunes to it', () => {
    useTVStore.setState({ previousChannelId: 'e2' })
    renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'Back to Cartoons' }))

    expect(useTVStore.getState().selectedChannel).toMatchObject({ id: 'e2', name: 'Cartoons', type: 'ersatztv' })
    expect(useTVStore.getState().previousChannelId).toBe('e3')
  })

  it("goes back to the live slot for this viewer only, never changing the club's live channel", () => {
    useChannelStore.setState({ currentChannel: tsn })
    useTVStore.setState({ previousChannelId: LIVE_CHANNEL_ID })
    renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'Back to TSN 5' }))

    expect(useTVStore.getState().selectedChannel).toMatchObject({ id: LIVE_CHANNEL_ID, number: 0 })
    expect(useChannelStore.getState().currentChannel).toBe(tsn)
  })

  it('offers no Back without a previous channel that can still play', () => {
    renderCard()
    expect(screen.queryByRole('button', { name: /Back to/ })).not.toBeInTheDocument()
  })

  it('offers no Back to a channel that is no longer listed', () => {
    useTVStore.setState({ previousChannelId: 'gone' })
    renderCard()
    expect(screen.queryByRole('button', { name: /Back to/ })).not.toBeInTheDocument()
  })

  it('offers no Back to the live slot while live TV is stopped', () => {
    useTVStore.setState({ previousChannelId: LIVE_CHANNEL_ID })
    renderCard()
    expect(screen.queryByRole('button', { name: /Back to/ })).not.toBeInTheDocument()
  })

  it('where the browser cannot play the stream, says so and offers Back but no Retry', () => {
    useTVStore.setState({ previousChannelId: 'e2' })
    renderCard({ status: 'unsupported' })

    expect(screen.getByRole('alert')).toHaveTextContent("Can't play live TV here")
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to Cartoons' })).toBeInTheDocument()
  })
})
