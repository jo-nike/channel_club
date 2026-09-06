import { render, screen, waitFor, fireEvent } from '@/test/utils'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { ApplicationStatus } from './ApplicationStatus'
import { StatusTab } from './StatusTab'
import { APP_VERSION } from '@/lib/appInfo'

vi.mock('@/hooks/useSystemStatus', () => ({
  useSystemStatus: () => ({ data: null, loading: false, error: 'Upstream offline' }),
}))

const health = { status: 'ok', version: APP_VERSION, buildId: 'unique-build', revision: 'abc1234' }
const fetchMock = vi.fn()
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset() })
afterEach(() => vi.unstubAllGlobals())

describe('Application information', () => {
  it('shows actual backend build information despite upstream failure', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(health)))
    render(<StatusTab />)
    expect(screen.getByText(/Upstream offline/)).toBeInTheDocument()
    expect(await screen.findByText('unique-build')).toBeInTheDocument()
    expect(screen.getByText('abc1234')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('warns when the frontend differs from the running backend', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ...health, version: '9.0.0' })))
    render(<ApplicationStatus />)
    expect(await screen.findByRole('alert')).toHaveTextContent('versions differ')
    expect(screen.getByText('v9.0.0')).toBeInTheDocument()
  })

  it.each([
    new Response('bad gateway', { status: 502 }),
    new Response(JSON.stringify({ status: 'ok' })),
  ])('shows unavailable instead of a guessed version, and supports retry', async response => {
    fetchMock.mockResolvedValueOnce(response)
    render(<ApplicationStatus />)
    expect(await screen.findByText('Application information is unavailable.')).toBeInTheDocument()
    expect(screen.getAllByText('Unavailable')).toHaveLength(3)
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(health)))
    fireEvent.click(screen.getByRole('button', { name: 'Retry application info' }))
    expect(await screen.findByText('unique-build')).toBeInTheDocument()
  })

  it('cancels a pending request when the status panel is closed', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}))
    const { unmount } = render(<ApplicationStatus />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal
    unmount()
    expect(signal.aborted).toBe(true)
  })
})
