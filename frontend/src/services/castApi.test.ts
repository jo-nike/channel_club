import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createCastSession } from './api'
import { useAuthStore } from '@/stores/authStore'

const sentBody = () => JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))

describe('createCastSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ session_id: 's', hls_url: '/fixture', needs_transcoding: true }),
    } as Response)
    useAuthStore.setState({ token: 'fixture-token', role: 'viewer', isAuthenticated: true })
  })

  it('sends no stream URL: the server resolves the source itself', async () => {
    await createCastSession('7', 'mpegts')

    expect(sentBody()).toEqual({ channel_id: '7', stream_type: 'mpegts', follows_live: false })
  })

  it('asks for a cast that follows Live', async () => {
    await createCastSession('7', 'mpegts', true)

    expect(sentBody()).toEqual({ channel_id: '7', stream_type: 'mpegts', follows_live: true })
  })
})
