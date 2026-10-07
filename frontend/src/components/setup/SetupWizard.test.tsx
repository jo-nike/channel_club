import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { useTVMode } from '@/hooks/useTVMode'
import * as plexAuth from '@/services/plexAuth'
import * as setupApi from '@/services/setupApi'
import { SetupApiError } from '@/services/setupApi'
import type { TokenResponse } from '@/services/api'
import { useAuthStore } from '@/stores/authStore'
import { configView } from '@/test/settingsFixtures'
import { focusedStepHeading, pending, renderWizard, session } from '@/test/setupWizard'
import type { ConfigView, PlexServersResponse } from '@/types/setup'
import type { WizardAdmin } from './wizardReducer'

vi.mock('@/services/setupApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/setupApi')>()),
  claimSetup: vi.fn(),
  getAdminConfig: vi.fn(),
  getPlexMembers: vi.fn(),
  listPlexServers: vi.fn(),
}))

// The popup and the redirect's return are faked; the flow around them is real
vi.mock('@/services/plexAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/plexAuth')>()),
  authenticateWithPlex: vi.fn(),
  openPlexAuthWindow: vi.fn(),
  finishPlexRedirect: vi.fn(),
}))

vi.mock('@/hooks/useTVMode', () => ({ useTVMode: vi.fn(() => false) }))

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// A code sign-in, finished by pressing a button
vi.mock('@/components/QRPlexLogin', () => ({
  QRPlexLogin: ({ onSuccess, onCancel }: { onSuccess: (token: string) => void; onCancel: () => void }) => (
    <div>
      <button type="button" onClick={() => onSuccess('code-token')}>
        Finish the code sign-in
      </button>
      <button type="button" onClick={onCancel}>
        Leave the code
      </button>
    </div>
  ),
}))

const PASS = 'correct horse battery'
const ADMIN: WizardAdmin = { signIn: 'password', username: 'sam', plexId: null }
const SERVERS: PlexServersResponse = {
  account: { username: 'jon' },
  servers: [
    { machineId: 'cabin', name: 'Cabin NAS', online: false, memberCount: 1 },
    { machineId: 'home', name: 'Home Server', online: true, memberCount: 6 },
  ],
}
const plexWindow = { closed: false, close: vi.fn() } as unknown as Window

const rail = () => screen.getByRole('navigation', { name: 'Setup steps' })
const continueButton = () => screen.getByRole('button', { name: 'Continue' })

async function openAccount() {
  fireEvent.click(screen.getByRole('button', { name: 'Start setup' }))
  await screen.findByRole('heading', { level: 1, name: 'How will you sign in?' })
}

function fillPasswordAccount(username = 'sam', password = PASS, confirm = password) {
  fireEvent.click(screen.getByRole('radio', { name: /Username and password/ }))
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: username } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } })
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: confirm } })
}

async function signInToPlex(found: PlexServersResponse = SERVERS) {
  vi.mocked(plexAuth.authenticateWithPlex).mockResolvedValue('tok-1')
  vi.mocked(setupApi.listPlexServers).mockResolvedValue(found)
  fireEvent.click(screen.getByRole('button', { name: 'Sign in with Plex' }))
  await screen.findByText('Signed in to Plex as jon')
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  useAuthStore.setState({ token: null, role: null, username: null, isAuthenticated: false, isInitializing: false })
  // jsdom doesn't scroll
  window.scrollTo = vi.fn()
  vi.mocked(useTVMode).mockReturnValue(false)
  vi.mocked(plexAuth.openPlexAuthWindow).mockReturnValue(plexWindow)
  vi.mocked(setupApi.getAdminConfig).mockResolvedValue(configView())
})

describe('SetupWizard: Welcome', () => {
  it('opens at Welcome; Start setup opens Your account with its heading focused', async () => {
    renderWizard()

    expect(screen.getByRole('heading', { level: 1, name: 'Welcome to Channel Club' })).not.toHaveFocus()
    expect(screen.getByText('Takes about five minutes')).toBeInTheDocument()
    expect(within(rail()).getByRole('button', { name: 'Welcome' })).toHaveAttribute('aria-current', 'step')
    expect(within(rail()).getByRole('button', { name: 'Your account' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Start setup' }))

    const heading = await screen.findByRole('heading', { level: 1, name: 'How will you sign in?' })
    expect(heading).toHaveFocus()
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
    expect(screen.queryByText('Takes about five minutes')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'How will you sign in?' })).toBeInTheDocument()
    expect(within(rail()).getByRole('button', { name: 'Your account' })).toHaveAttribute('aria-current', 'step')
    expect(within(rail()).getByRole('button', { name: 'Welcome, done' })).toBeEnabled()
    expect(within(rail()).getByRole('button', { name: 'Channels' })).toBeDisabled()
    // The header narrow windows show in place of the rail
    expect(within(screen.getByRole('banner')).getByText('Step 2 of 6')).toBeInTheDocument()
    expect(within(screen.getByRole('banner')).getByText('Your account')).toBeInTheDocument()
    // Nothing is kept before the club is claimed
    expect(localStorage.getItem('channel-club:setup-progress')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    await focusedStepHeading('Welcome to Channel Club')
  })

  it("lists what this server's environment sets", () => {
    renderWizard({ envLocked: [{ env: 'DISPATCHARR_URL', field: 'dispatcharrUrl' }, { env: 'LOG_FORMAT', field: null }] })

    expect(screen.getByText("2 settings come from this server's environment.")).toBeInTheDocument()
    expect(screen.getByText('DISPATCHARR_URL')).toBeInTheDocument()
    expect(screen.getByText('LOG_FORMAT')).toBeInTheDocument()
  })

  it('says nothing about the environment when it sets nothing, and counts one setting as one', () => {
    renderWizard()
    expect(screen.queryByText(/from this server's environment/)).not.toBeInTheDocument()
    cleanup()

    renderWizard({ envLocked: [{ env: 'LOG_LEVEL', field: 'logLevel' }] })
    expect(screen.getByText("1 setting comes from this server's environment.")).toBeInTheDocument()
  })

  it("opens a new club at Welcome, whatever progress an old one left", () => {
    localStorage.setItem('channel-club:setup-progress', JSON.stringify({ step: 'extras', reached: 4 }))
    renderWizard()
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome to Channel Club' })).toBeInTheDocument()
  })

  it('keeps focused controls clear of the action bar while it shows', () => {
    renderWizard({}, { strict: true })
    expect(document.documentElement).toHaveClass('setup-action-bar')

    cleanup()
    expect(document.documentElement).not.toHaveClass('setup-action-bar')
  })
})

describe('SetupWizard: a password account', () => {
  it('checks the account, moving focus to the first field with a problem', async () => {
    renderWizard()
    await openAccount()
    fillPasswordAccount('', 'short')
    const username = screen.getByLabelText('Username')
    // The error is already tied to the field when focus lands, so it's read with it
    let describedOnFocus: string | null = null
    username.addEventListener('focus', () => {
      describedOnFocus = username.getAttribute('aria-describedby')
    })

    fireEvent.click(continueButton())

    expect(describedOnFocus).toBe('setup-account-username-err')
    expect(username).toHaveFocus()
    expect(username).toHaveAttribute('aria-invalid', 'true')
    expect(username).toHaveAccessibleDescription('Choose a username.')
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription('Use at least 12 characters.')

    fireEvent.change(username, { target: { value: 'sam' } })
    fireEvent.click(continueButton())
    expect(screen.getByLabelText('Password')).toHaveFocus()

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASS } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'correct horse' } })
    fireEvent.click(continueButton())
    expect(screen.getByLabelText('Confirm password')).toHaveFocus()
    expect(screen.getByLabelText('Confirm password')).toHaveAccessibleDescription("The passwords don't match.")
    expect(setupApi.claimSetup).not.toHaveBeenCalled()
  })

  it('claims the club: signs in, opens Channels and keeps the progress', async () => {
    const claim = pending<TokenResponse>()
    const answer = session({ sub: 'sam', role: 'admin' })
    vi.mocked(setupApi.claimSetup).mockReturnValue(claim.promise)
    renderWizard()
    await openAccount()
    fillPasswordAccount()

    fireEvent.click(continueButton())

    expect(setupApi.claimSetup).toHaveBeenCalledWith({ method: 'password', username: 'sam', password: PASS })
    const creating = screen.getByRole('button', { name: 'Creating your account…' })
    expect(creating).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()
    // Pressed again while it works: still one claim
    fireEvent.click(creating)
    expect(setupApi.claimSetup).toHaveBeenCalledOnce()

    await act(async () => claim.settle(answer))

    await focusedStepHeading('Where do your channels come from?')
    expect(useAuthStore.getState()).toMatchObject({ token: answer.accessToken, role: 'admin', username: 'sam', isAuthenticated: true })
    expect(within(rail()).getByRole('button', { name: 'Channels' })).toHaveAttribute('aria-current', 'step')
    expect(within(rail()).getByRole('button', { name: 'Your account, done' })).toHaveAccessibleDescription('Password · sam')
    expect(JSON.parse(localStorage.getItem('channel-club:setup-progress')!)).toEqual({ step: 'sources', reached: 2 })
    await waitFor(() => expect(setupApi.getAdminConfig).toHaveBeenCalledOnce())

    // Your account can be looked at again, but not changed
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    expect(await screen.findByText('Signed in as sam')).toBeInTheDocument()
    expect(screen.getByText('Username and password')).toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  })

  it('offers the sign-in page when someone else set up the club first', async () => {
    vi.mocked(setupApi.claimSetup).mockRejectedValue(
      new SetupApiError(409, 'Channel Club has already been claimed', { code: 'already_claimed' })
    )
    const router = renderWizard()
    await openAccount()
    fillPasswordAccount()

    fireEvent.click(continueButton())

    expect(await screen.findByRole('alert')).toHaveTextContent('Someone else set up this club first.')
    expect(continueButton()).not.toHaveAttribute('aria-disabled')

    fireEvent.click(screen.getByRole('button', { name: 'Go to sign in' }))

    expect(await screen.findByText('Home page')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
  })

  it('puts a username the server refused on the field, and focuses it', async () => {
    vi.mocked(setupApi.claimSetup).mockRejectedValue(
      new SetupApiError(422, 'String should match pattern', { code: 'string_pattern_mismatch', fieldErrors: { username: 'String should match pattern' } })
    )
    renderWizard()
    await openAccount()
    fillPasswordAccount()

    fireEvent.click(continueButton())

    const username = screen.getByLabelText('Username')
    await waitFor(() => expect(username).toHaveFocus())
    expect(username).toHaveAccessibleDescription('String should match pattern')
  })
})

describe('SetupWizard: a Plex account', () => {
  it('claims the club with the server picked, as its admin', async () => {
    vi.mocked(setupApi.claimSetup).mockResolvedValue(session({ sub: 'jon', role: 'admin', plex_id: '101' }))
    // Linked at the claim; a source too, so Channels has nothing to ask
    vi.mocked(setupApi.getAdminConfig).mockResolvedValue(
      configView(
        { plexAuthEnabled: true, plexServerMachineId: 'cabin', plexAdminIds: ['101'], dispatcharrUrl: 'https://tv.example.com', dispatcharrApiKey: { set: true } },
        { plexServerName: 'Cabin NAS' }
      )
    )
    vi.mocked(setupApi.getPlexMembers).mockResolvedValue([
      { plexId: '101', username: 'jon', managed: false, owner: true, admin: true },
      { plexId: '202', username: 'sam', managed: false, owner: false, admin: false },
    ])
    renderWizard()
    await openAccount()
    expect(screen.getByRole('radio', { name: /Plex account/ })).toBeChecked()

    await signInToPlex()

    expect(setupApi.listPlexServers).toHaveBeenCalledWith('tok-1', expect.any(AbortSignal))
    expect(screen.getByText('Owner of 2 servers')).toBeInTheDocument()
    // The first server online is picked
    expect(screen.getByRole('radio', { name: /Home Server/ })).toBeChecked()

    fireEvent.click(screen.getByRole('radio', { name: /Cabin NAS/ }))
    fireEvent.click(continueButton())

    await focusedStepHeading('Where do your channels come from?')
    expect(setupApi.claimSetup).toHaveBeenCalledWith({ method: 'plex', authToken: 'tok-1', machineId: 'cabin' })
    expect(useAuthStore.getState()).toMatchObject({ role: 'admin', username: 'jon' })
    await waitFor(() =>
      expect(within(rail()).getByRole('button', { name: 'Your account, done' })).toHaveAccessibleDescription('Plex · Cabin NAS')
    )

    // Among the server's members, the admin is marked as the one at the screen
    fireEvent.click(continueButton())
    expect(await screen.findByRole('heading', { level: 1, name: 'Who can join?' })).toBeInTheDocument()
    expect(await screen.findByText('You · server owner')).toBeInTheDocument()
  })

  it('stays signed out when the sign-in is cancelled while the servers load', async () => {
    const listing = pending<PlexServersResponse>()
    vi.mocked(plexAuth.authenticateWithPlex).mockResolvedValue('tok-1')
    vi.mocked(setupApi.listPlexServers).mockReturnValue(listing.promise)
    renderWizard()
    await openAccount()

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Plex' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await act(async () => listing.settle(SERVERS))

    expect(screen.queryByText('Signed in to Plex as jon')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in with Plex' })).toBeEnabled()
  })

  it('signs out of Plex when Plex refuses the sign-in at the claim', async () => {
    vi.mocked(setupApi.claimSetup).mockRejectedValue(new SetupApiError(400, "Plex didn't accept that sign-in", { code: 'plex_token' }))
    renderWizard()
    await openAccount()
    await signInToPlex()

    fireEvent.click(continueButton())

    expect(await screen.findByRole('alert')).toHaveTextContent("Plex didn't accept that sign-in. Sign in with Plex again.")
    expect(screen.getByRole('button', { name: 'Sign in with Plex' })).toBeInTheDocument()
  })

  it('asks for a Plex sign-in first, focusing its button', async () => {
    renderWizard()
    await openAccount()

    fireEvent.click(continueButton())

    expect(screen.getByRole('alert')).toHaveTextContent('Sign in with Plex to continue.')
    expect(screen.getByRole('button', { name: 'Sign in with Plex' })).toHaveFocus()
    expect(setupApi.claimSetup).not.toHaveBeenCalled()
  })

  it('asks for a Plex account that owns a server', async () => {
    renderWizard()
    await openAccount()
    await signInToPlex({ account: { username: 'jon' }, servers: [] })

    expect(screen.getByText('Owns no Plex servers')).toBeInTheDocument()
    expect(screen.getByText("This Plex account doesn't own a server. Sign in with the account that owns yours.")).toBeInTheDocument()

    fireEvent.click(continueButton())

    expect(screen.getByRole('alert')).toHaveTextContent('Sign in with a Plex account that owns a server to continue.')
    const switchAccount = screen.getByRole('button', { name: 'Use another account' })
    expect(switchAccount).toHaveFocus()

    fireEvent.click(switchAccount)

    expect(screen.getByRole('button', { name: 'Sign in with Plex' })).toHaveFocus()
    expect(screen.queryByText('Signed in to Plex as jon')).not.toBeInTheDocument()
  })

  it("says why the servers couldn't be listed", async () => {
    vi.mocked(plexAuth.authenticateWithPlex).mockResolvedValue('tok-1')
    vi.mocked(setupApi.listPlexServers).mockRejectedValue(new SetupApiError(503, 'Plex is not responding', { code: 'plex_unavailable' }))
    renderWizard()
    await openAccount()

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Plex' }))

    expect(await screen.findByRole('alert')).toHaveTextContent("Plex isn't responding. Try again in a moment.")
    expect(screen.getByRole('button', { name: 'Sign in with Plex' })).toBeEnabled()
  })

  it('offers Try again and a code when the Plex window was blocked', async () => {
    vi.mocked(plexAuth.openPlexAuthWindow).mockReturnValue(null)
    vi.mocked(setupApi.listPlexServers).mockResolvedValue(SERVERS)
    renderWizard()
    await openAccount()

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Plex' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Your browser blocked the Plex window.')
    fireEvent.click(within(alert).getByRole('button', { name: 'Sign in with a code' }))
    fireEvent.click(screen.getByRole('button', { name: 'Finish the code sign-in' }))

    expect(await screen.findByText('Signed in to Plex as jon')).toBeInTheDocument()
    expect(setupApi.listPlexServers).toHaveBeenCalledWith('code-token', expect.any(AbortSignal))
  })

  it("stops a code sign-in's server listing on Cancel, and offers no second code meanwhile", async () => {
    // Like fetch: an aborted listing rejects
    vi.mocked(setupApi.listPlexServers).mockImplementation(
      (_token, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        }),
    )
    renderWizard()
    await openAccount()

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with a code' }))
    fireEvent.click(screen.getByRole('button', { name: 'Finish the code sign-in' }))

    expect(await screen.findByRole('button', { name: 'Waiting for Plex...' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Sign in with a code' })).toBeDisabled()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Cancel' })))

    expect(vi.mocked(setupApi.listPlexServers).mock.calls[0][1]?.aborted).toBe(true)
    expect(screen.getByRole('button', { name: 'Sign in with Plex' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Sign in with a code' })).toBeEnabled()
    // Cancelling is not a failure
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('signs in with a code on a TV', async () => {
    vi.mocked(useTVMode).mockReturnValue(true)
    vi.mocked(setupApi.listPlexServers).mockResolvedValue(SERVERS)
    renderWizard()
    await openAccount()
    expect(screen.queryByRole('button', { name: 'Sign in with a code' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Plex' }))

    expect(plexAuth.openPlexAuthWindow).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Finish the code sign-in' }))
    expect(await screen.findByText('Signed in to Plex as jon')).toBeInTheDocument()
  })

  it('lists the servers again on Refresh, keeping the one picked', async () => {
    renderWizard()
    await openAccount()
    await signInToPlex()
    fireEvent.click(screen.getByRole('radio', { name: /Cabin NAS/ }))
    vi.mocked(setupApi.listPlexServers).mockResolvedValueOnce({
      ...SERVERS,
      servers: [...SERVERS.servers, { machineId: 'lake', name: 'Lake House', online: true }],
    })

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    expect(await screen.findByRole('radio', { name: /Lake House/ })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: /Cabin NAS/ })).toBeChecked()
    expect(setupApi.listPlexServers).toHaveBeenLastCalledWith('tok-1')
  })

  it('signs out of Plex when Plex no longer takes the sign-in', async () => {
    renderWizard()
    await openAccount()
    await signInToPlex()
    vi.mocked(setupApi.listPlexServers).mockRejectedValueOnce(new SetupApiError(400, "Plex didn't accept that sign-in", { code: 'plex_token' }))

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    expect(await screen.findByRole('alert')).toHaveTextContent("Plex didn't accept that sign-in. Sign in with Plex again.")
    expect(screen.getByRole('button', { name: 'Sign in with Plex' })).toBeInTheDocument()
  })

  it('comes back from a Plex redirect to the step it left, signed in to Plex', async () => {
    sessionStorage.setItem('plex-pending-pin', '42')
    sessionStorage.setItem(
      'channel-club:setup-stash',
      JSON.stringify({ step: 'account', reached: 1, account: { method: 'plex', username: 'admin' }, draft: null })
    )
    vi.mocked(plexAuth.finishPlexRedirect).mockResolvedValue('tok-1')
    vi.mocked(setupApi.listPlexServers).mockResolvedValue(SERVERS)

    renderWizard({}, { strict: true })

    // Opened there, so the heading isn't moved to
    expect(screen.getByRole('heading', { level: 1, name: 'How will you sign in?' })).not.toHaveFocus()
    expect(await screen.findByText('Signed in to Plex as jon')).toBeInTheDocument()
    expect(plexAuth.finishPlexRedirect).toHaveBeenCalledWith(42, expect.any(AbortSignal))
    expect(sessionStorage.getItem('channel-club:setup-stash')).toBeNull()
  })

  it('ignores a stash no Plex sign-in is waiting on', () => {
    sessionStorage.setItem(
      'channel-club:setup-stash',
      JSON.stringify({ step: 'account', reached: 1, account: { method: 'plex', username: 'admin' }, draft: null })
    )

    renderWizard()

    expect(screen.getByRole('heading', { level: 1, name: 'Welcome to Channel Club' })).toBeInTheDocument()
    expect(sessionStorage.getItem('channel-club:setup-stash')).toBeNull()
  })
})

/** Settings loads the test settles; like a real request, each fails when its signal aborts. */
function settingsLoads() {
  const loads: ((view: ConfigView) => void)[] = []
  vi.mocked(setupApi.getAdminConfig).mockImplementation(
    (signal) =>
      new Promise((resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')))
        loads.push(resolve)
      })
  )
  return loads
}

describe('SetupWizard: a claimed club', () => {
  it('opens where the admin left off, and loads the settings', async () => {
    localStorage.setItem('channel-club:setup-progress', JSON.stringify({ step: 'extras', reached: 4 }))
    const loads = settingsLoads()

    // StrictMode starts the load twice; the first one's abort is no failure
    renderWizard({ setupState: 'claimed', admin: ADMIN }, { strict: true })
    await act(() => new Promise((done) => setTimeout(done)))

    expect(setupApi.getAdminConfig).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('heading', { level: 1, name: 'Add the extras' })).not.toHaveFocus()
    expect(screen.getByRole('status')).toHaveTextContent("Loading the server's settings…")
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(within(rail()).getByRole('button', { name: 'Extras' })).toHaveAttribute('aria-current', 'step')
    expect(within(rail()).getByRole('button', { name: 'Review' })).toBeDisabled()

    await act(async () => loads.at(-1)?.(configView()))

    expect(screen.queryByText("Loading the server's settings…")).not.toBeInTheDocument()
    fireEvent.click(within(rail()).getByRole('button', { name: 'Channels, done' }))
    await focusedStepHeading('Where do your channels come from?')
    expect(JSON.parse(localStorage.getItem('channel-club:setup-progress')!)).toEqual({ step: 'sources', reached: 4 })
  })

  it("says when the settings didn't load, and tries again", async () => {
    const retry = pending<ConfigView>()
    vi.mocked(setupApi.getAdminConfig)
      .mockRejectedValueOnce(new SetupApiError(500, "Couldn't load the server settings"))
      .mockReturnValueOnce(retry.promise)

    renderWizard({ setupState: 'claimed', admin: ADMIN })

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load the server settings")

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent("Loading the server's settings…")
    expect(setupApi.getAdminConfig).toHaveBeenCalledTimes(2)

    await act(async () => retry.settle(configView()))

    expect(screen.queryByText("Loading the server's settings…")).not.toBeInTheDocument()
  })

  it.each([
    [401, 'Sign in again to finish setting up.'],
    [403, 'Only an admin can set up Channel Club.'],
  ])('leaves for the sign-in page after a %i, with a toast there', async (status, message) => {
    vi.mocked(setupApi.getAdminConfig).mockRejectedValue(new SetupApiError(status, 'Not now'))

    const router = renderWizard({ setupState: 'claimed', admin: ADMIN })

    expect(await screen.findByText('Home page')).toBeInTheDocument()
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
  })
})
