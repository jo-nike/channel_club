import { describe, it, expect, beforeEach, vi } from 'vitest'
import { StrictMode } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import * as setupApi from '@/services/setupApi'
import { SetupApiError } from '@/services/setupApi'
import { useAuthStore } from '@/stores/authStore'
import type { SetupStatus } from '@/types/setup'
import { SetupRoute } from './SetupRoute'
import type { WizardProps } from './useSetupWizard'

vi.mock('@/services/setupApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/setupApi')>()),
  getSetupStatus: vi.fn(),
}))

// The wizard itself has its own tests; here, only what the route hands it
vi.mock('./SetupWizard', () => ({
  SetupWizard: ({ setupState, envLocked, admin }: WizardProps) => (
    <p>
      Wizard: {setupState}, {envLocked.map((lock) => lock.env).join(' ') || 'no env'},{' '}
      {admin ? `${admin.signIn} admin ${admin.username} ${admin.plexId ?? '-'}` : 'no admin'}
    </p>
  ),
}))

const PROGRESS_KEY = 'channel-club:setup-progress'

function sessionToken(claims: Record<string, unknown>): string {
  return `header.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, ...claims }))}.signature`
}

/** A session this browser kept, as the auth store restores it. */
function signedIn(role: 'admin' | 'viewer', claims: Record<string, unknown>) {
  const token = sessionToken({ role, ...claims })
  localStorage.setItem('token', token)
  localStorage.setItem('role', role)
  return token
}

function status(setupState: SetupStatus['setupState'], envLocked: SetupStatus['envLocked'] = []): SetupStatus {
  return { setupState, envLocked }
}

/** /setup and a home page to be sent to. `strict` puts StrictMode at the root, where it runs each effect twice. */
function renderRoute({ strict = false } = {}) {
  const router = createMemoryRouter(
    [
      { path: '/setup', element: <SetupRoute /> },
      { path: '/', element: <p>Home page</p> },
    ],
    { initialEntries: ['/setup'] }
  )
  const app = <RouterProvider router={router} />
  render(strict ? <StrictMode>{app}</StrictMode> : app)
  return router
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  useAuthStore.setState({ token: null, role: null, username: null, isAuthenticated: false, isInitializing: true })
})

describe('SetupRoute', () => {
  it('shows the loading screen until it knows where setup is', () => {
    vi.mocked(setupApi.getSetupStatus).mockReturnValue(new Promise(() => {}))
    renderRoute()
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('opens the wizard for anyone while the club is unclaimed, with what the environment sets', async () => {
    vi.mocked(setupApi.getSetupStatus).mockResolvedValue(status('unclaimed', [{ env: 'DISPATCHARR_URL', field: 'dispatcharrUrl' }]))
    renderRoute()
    expect(await screen.findByText('Wizard: unclaimed, DISPATCHARR_URL, no admin')).toBeInTheDocument()
  })

  it('signs out a session kept from before the club was set up, and forgets its progress', async () => {
    signedIn('admin', { sub: 'sam' })
    localStorage.setItem(PROGRESS_KEY, JSON.stringify({ step: 'extras', reached: 4 }))
    vi.mocked(setupApi.getSetupStatus).mockResolvedValue(status('unclaimed'))

    renderRoute()

    expect(await screen.findByText('Wizard: unclaimed, no env, no admin')).toBeInTheDocument()
    expect(useAuthStore.getState()).toMatchObject({ token: null, isAuthenticated: false })
    expect(localStorage.getItem('token')).toBeNull()
    expect(localStorage.getItem(PROGRESS_KEY)).toBeNull()
  })

  it('opens the wizard for the admin of a claimed club, signed in with a password', async () => {
    signedIn('admin', { sub: 'sam' })
    vi.mocked(setupApi.getSetupStatus).mockResolvedValue(status('claimed'))
    renderRoute()
    expect(await screen.findByText('Wizard: claimed, no env, password admin sam -')).toBeInTheDocument()
  })

  it('opens the wizard for the admin of a claimed club, signed in with Plex', async () => {
    signedIn('admin', { sub: 'jon', plex_id: '101' })
    vi.mocked(setupApi.getSetupStatus).mockResolvedValue(status('claimed'))
    renderRoute()
    expect(await screen.findByText('Wizard: claimed, no env, plex admin jon 101')).toBeInTheDocument()
  })

  it.each([
    ['signed out', () => {}],
    ['a viewer', () => signedIn('viewer', { sub: 'guest' })],
  ])('sends someone %s home while the club is claimed', async (_who, arrange) => {
    arrange()
    vi.mocked(setupApi.getSetupStatus).mockResolvedValue(status('claimed'))
    const router = renderRoute()
    expect(await screen.findByText('Home page')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
  })

  it('sends everyone home once setup is complete', async () => {
    signedIn('admin', { sub: 'sam' })
    vi.mocked(setupApi.getSetupStatus).mockResolvedValue(status('complete'))
    renderRoute()
    expect(await screen.findByText('Home page')).toBeInTheDocument()
  })

  it("isn't put off by StrictMode stopping its first check", async () => {
    // Like a real request, each check fails when its signal aborts
    vi.mocked(setupApi.getSetupStatus).mockImplementation(
      (signal) =>
        new Promise((resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')))
          setTimeout(() => resolve(status('unclaimed')))
        })
    )

    renderRoute({ strict: true })

    expect(await screen.findByText('Wizard: unclaimed, no env, no admin')).toBeInTheDocument()
    expect(setupApi.getSetupStatus).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it("says when the server can't be reached, and tries again", async () => {
    vi.mocked(setupApi.getSetupStatus)
      .mockRejectedValueOnce(new SetupApiError(0, "Couldn't reach Channel Club's server.", { code: 'network' }))
      .mockResolvedValueOnce(status('unclaimed'))
    renderRoute()

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't reach Channel Club's server.")

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Wizard: unclaimed, no env, no admin')).toBeInTheDocument()
    expect(setupApi.getSetupStatus).toHaveBeenCalledTimes(2)
  })
})
