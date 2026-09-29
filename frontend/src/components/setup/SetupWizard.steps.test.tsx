import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import * as plexAuth from '@/services/plexAuth'
import * as setupApi from '@/services/setupApi'
import { SetupApiError } from '@/services/setupApi'
import { useAuthStore } from '@/stores/authStore'
import { configView } from '@/test/settingsFixtures'
import { pending, renderWizard } from '@/test/setupWizard'
import type { ConfigUpdate, ConfigValues, ConfigView, PlexMember, PlexServersResponse } from '@/types/setup'
import type { StepId } from './steps'
import type { WizardAdmin } from './wizardReducer'

// Channels, Who can join and Extras: each checks, tests and saves the server's settings

vi.mock('@/services/setupApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/setupApi')>()),
  getAdminConfig: vi.fn(),
  getPlexMembers: vi.fn(),
  linkPlexServer: vi.fn(),
  listPlexServers: vi.fn(),
  testConnection: vi.fn(),
  updateAdminConfig: vi.fn(),
}))

vi.mock('@/services/plexAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/plexAuth')>()),
  authenticateWithPlex: vi.fn(),
  openPlexAuthWindow: vi.fn(),
}))

vi.mock('@/hooks/useTVMode', () => ({ useTVMode: () => false }))

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const KEY = 'api key one'
const PROGRESS_KEY = 'channel-club:setup-progress'
const PASSWORD_ADMIN: WizardAdmin = { signIn: 'password', username: 'sam', plexId: null }
const PLEX_ADMIN: WizardAdmin = { signIn: 'plex', username: 'jon', plexId: '101' }
/** What the server has once a password admin claimed it */
const CLAIMED: Partial<ConfigValues> = { localAuthEnabled: true, adminUsername: 'sam', adminPassword: { set: true } }
const DISPATCHARR_SAVED: Partial<ConfigValues> = { ...CLAIMED, dispatcharrUrl: 'https://tv.example.com', dispatcharrApiKey: { set: true } }
const SERVERS: PlexServersResponse = {
  account: { username: 'jon' },
  servers: [{ machineId: 'home', name: 'Home Server', online: true, memberCount: 1 }],
}
const MEMBERS: PlexMember[] = [
  { plexId: '101', username: 'jon', managed: false, owner: true, admin: true },
  { plexId: '202', username: 'sam', managed: false, owner: false, admin: false },
]
const plexWindow = { closed: false, close: vi.fn() } as unknown as Window

const rail = () => screen.getByRole('navigation', { name: 'Setup steps' })
const continueButton = () => screen.getByRole('button', { name: 'Continue' })

function saved(values: Partial<ConfigValues>, overrides: Partial<Omit<ConfigView, 'values'>> = {}): ConfigUpdate {
  return { config: configView(values, overrides), warnings: [] }
}

/** A claimed club opened at `step`, with these settings on the server. */
function openAt(step: StepId, reached: number, { admin = PASSWORD_ADMIN, view = configView(CLAIMED) } = {}) {
  localStorage.setItem(PROGRESS_KEY, JSON.stringify({ step, reached }))
  vi.mocked(setupApi.getAdminConfig).mockResolvedValue(view)
  return renderWizard({ setupState: 'claimed', admin })
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  useAuthStore.setState({ token: null, role: null, username: null, isAuthenticated: false, isInitializing: false })
  window.scrollTo = vi.fn()
  vi.mocked(plexAuth.openPlexAuthWindow).mockReturnValue(plexWindow)
  vi.mocked(setupApi.getPlexMembers).mockResolvedValue(MEMBERS)
})

describe('SetupWizard: Channels', () => {
  it('checks the sources before saving, focusing the first problem', async () => {
    openAt('sources', 2)
    // With no source set up yet, Dispatcharr starts switched on
    const address = await screen.findByLabelText('Address')

    fireEvent.click(continueButton())

    expect(address).toHaveFocus()
    expect(address).toHaveAccessibleDescription(expect.stringContaining('Enter the full address, starting with https:// or http://.'))
    expect(screen.getByLabelText('API key')).toHaveAccessibleDescription(
      expect.stringContaining('Paste the API key from your Dispatcharr profile page.')
    )
    expect(setupApi.updateAdminConfig).not.toHaveBeenCalled()
  })

  it('asks for a source, focusing the Dispatcharr switch', async () => {
    openAt('sources', 2)
    fireEvent.click(await screen.findByRole('switch', { name: 'Dispatcharr' }))

    fireEvent.click(continueButton())

    expect(screen.getByRole('alert')).toHaveTextContent('Turn on Dispatcharr or ErsatzTV. The club needs at least one source of channels.')
    expect(screen.getByRole('switch', { name: 'Dispatcharr' })).toHaveFocus()
  })

  it('saves the sources, then opens Who can join', async () => {
    const saving = pending<ConfigUpdate>()
    vi.mocked(setupApi.updateAdminConfig).mockReturnValue(saving.promise)
    openAt('sources', 2)
    fireEvent.change(await screen.findByLabelText('Address'), { target: { value: ' https://tv.example.com ' } })
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: KEY } })

    fireEvent.click(continueButton())

    expect(setupApi.updateAdminConfig).toHaveBeenCalledWith({ dispatcharrUrl: 'https://tv.example.com', dispatcharrApiKey: KEY })
    expect(screen.getByRole('button', { name: 'Saving…' })).toHaveAttribute('aria-disabled', 'true')

    await act(async () => saving.settle(saved(DISPATCHARR_SAVED)))

    expect(await screen.findByRole('heading', { level: 1, name: 'Who can join?' })).toHaveFocus()
    expect(within(rail()).getByRole('button', { name: 'Channels, done' })).toHaveAccessibleDescription('Dispatcharr')
    expect(JSON.parse(localStorage.getItem(PROGRESS_KEY)!)).toEqual({ step: 'access', reached: 3 })
  })

  it('moves on without saving when nothing changed', async () => {
    openAt('sources', 2, { view: configView(DISPATCHARR_SAVED) })
    await screen.findByLabelText('Address')

    fireEvent.click(continueButton())

    expect(await screen.findByRole('heading', { level: 1, name: 'Who can join?' })).toBeInTheDocument()
    expect(setupApi.updateAdminConfig).not.toHaveBeenCalled()
  })

  it('puts a setting the server refused on its field, and focuses it', async () => {
    vi.mocked(setupApi.updateAdminConfig).mockRejectedValue(
      new SetupApiError(422, 'Enter it again for the new address', {
        code: 'secret_required',
        fieldErrors: { dispatcharrApiKey: 'Enter it again for the new address' },
      })
    )
    openAt('sources', 2, { view: configView(DISPATCHARR_SAVED) })
    fireEvent.change(await screen.findByLabelText('Address'), { target: { value: 'https://tv2.example.com' } })

    fireEvent.click(continueButton())

    expect(setupApi.updateAdminConfig).toHaveBeenCalledWith({ dispatcharrUrl: 'https://tv2.example.com' })
    const key = screen.getByLabelText('API key')
    await waitFor(() => expect(key).toHaveFocus())
    expect(key).toHaveAccessibleDescription(expect.stringContaining('Enter it again for the new address.'))
    expect(continueButton()).not.toHaveAttribute('aria-disabled')
  })

  it("says what stops the step when the server can't save", async () => {
    vi.mocked(setupApi.updateAdminConfig).mockRejectedValue(
      new SetupApiError(409, 'This server has no data folder to save settings in', { code: 'no_storage' })
    )
    openAt('sources', 2)
    fireEvent.change(await screen.findByLabelText('Address'), { target: { value: 'https://tv.example.com' } })
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: KEY } })

    fireEvent.click(continueButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This server has nowhere to keep settings. Give it a /data volume, restart it, then try again.'
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Where do your channels come from?' })).toBeInTheDocument()
  })

  it('leaves for the sign-in page when the session ended while saving', async () => {
    vi.mocked(setupApi.updateAdminConfig).mockRejectedValue(new SetupApiError(401, 'Your session has ended. Sign in again.'))
    // Saved without its key: typing one is the change to save
    openAt('sources', 2, { view: configView({ ...CLAIMED, dispatcharrUrl: 'https://tv.example.com' }) })
    fireEvent.change(await screen.findByLabelText('API key'), { target: { value: KEY } })

    fireEvent.click(continueButton())

    expect(await screen.findByText('Home page')).toBeInTheDocument()
    expect(await screen.findByText('Sign in again to finish setting up.')).toBeInTheDocument()
  })
})

describe('SetupWizard: connection tests', () => {
  it('tests with the values shown, then shows the verdict', async () => {
    vi.mocked(setupApi.testConnection).mockResolvedValue({ ok: true, counts: { channels: 37, groups: 4 } })
    openAt('sources', 2)
    fireEvent.change(await screen.findByLabelText('Address'), { target: { value: 'https://tv.example.com' } })
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: KEY } })

    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))

    expect(setupApi.testConnection).toHaveBeenCalledWith(
      'dispatcharr',
      { dispatcharrUrl: 'https://tv.example.com', dispatcharrApiKey: KEY },
      expect.any(AbortSignal)
    )
    expect(await screen.findByText('This server reached Dispatcharr')).toBeInTheDocument()
    expect(screen.getByText('API key accepted · 37 channels in 4 groups')).toBeInTheDocument()
  })

  it('asks for what a test needs before running it', async () => {
    openAt('sources', 2)

    fireEvent.click(await screen.findByRole('button', { name: 'Test connection' }))

    const address = screen.getByLabelText('Address')
    expect(address).toHaveFocus()
    expect(address).toHaveAccessibleDescription(expect.stringContaining('Enter the address first, starting with https:// or http://.'))
    expect(setupApi.testConnection).not.toHaveBeenCalled()
  })

  it("says why a test couldn't run", async () => {
    vi.mocked(setupApi.testConnection).mockRejectedValue(new SetupApiError(429, 'Wait a moment before testing again', { code: 'busy' }))
    openAt('sources', 2, { view: configView(DISPATCHARR_SAVED) })

    fireEvent.click(await screen.findByRole('button', { name: 'Test connection' }))

    expect(await screen.findByText('Wait a few seconds before testing again.')).toBeInTheDocument()
  })

  it("puts a saved key the server won't send to a new address on its field", async () => {
    vi.mocked(setupApi.testConnection).mockRejectedValue(
      new SetupApiError(422, 'Enter it again for the new address', {
        code: 'secret_required',
        fieldErrors: { dispatcharrApiKey: 'Enter it again for the new address' },
      })
    )
    openAt('sources', 2, { view: configView(DISPATCHARR_SAVED) })
    fireEvent.change(await screen.findByLabelText('Address'), { target: { value: 'https://tv2.example.com' } })

    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))

    const key = screen.getByLabelText('API key')
    await waitFor(() => expect(key).toHaveFocus())
    expect(key).toHaveAccessibleDescription(expect.stringContaining('Enter it again for the new address.'))
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeEnabled()
  })

  it('stops a test when another of its kind starts', async () => {
    const signals: AbortSignal[] = []
    vi.mocked(setupApi.testConnection).mockImplementation((_kind, _values, signal) => {
      if (signal) signals.push(signal)
      return new Promise(() => {})
    })
    openAt('sources', 2, { view: configView(DISPATCHARR_SAVED) })
    fireEvent.click(await screen.findByRole('button', { name: 'Test connection' }))
    // A new address offers the test again
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: 'https://tv2.example.com' } })

    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))

    expect(signals.map((signal) => signal.aborted)).toEqual([true, false])
  })
})

describe('SetupWizard: Who can join', () => {
  const linked = (values: Partial<ConfigValues> = {}) =>
    configView({ ...CLAIMED, plexServerMachineId: 'home', plexServerToken: { set: true }, ...values }, { plexServerName: 'Home Server' })

  async function signInToPlex() {
    vi.mocked(plexAuth.authenticateWithPlex).mockResolvedValue('tok-1')
    vi.mocked(setupApi.listPlexServers).mockResolvedValue(SERVERS)
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Plex' }))
    await screen.findByText('Signed in to Plex as jon')
  }

  it('links the Plex server picked on Continue, then saves Plex members', async () => {
    const linking = pending<ConfigUpdate>()
    vi.mocked(setupApi.linkPlexServer).mockReturnValue(linking.promise)
    vi.mocked(setupApi.updateAdminConfig).mockResolvedValue({ config: linked({ plexAuthEnabled: true }), warnings: [] })
    openAt('access', 3)
    fireEvent.click(await screen.findByRole('switch', { name: 'Plex members' }))

    fireEvent.click(continueButton())

    expect(screen.getByText('Sign in with Plex to choose the server, or switch Plex members off.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in with Plex' })).toHaveFocus()

    await signInToPlex()
    fireEvent.click(continueButton())

    expect(setupApi.linkPlexServer).toHaveBeenCalledWith({ authToken: 'tok-1', machineId: 'home' })
    expect(screen.getByRole('button', { name: 'Saving…' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'Use another account' })).toBeDisabled()
    // No members to list before a server is linked
    expect(setupApi.getPlexMembers).not.toHaveBeenCalled()

    await act(async () => linking.settle({ config: linked(), warnings: [] }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Add the extras' })).toHaveFocus()
    expect(setupApi.getPlexMembers).toHaveBeenCalled()
    expect(setupApi.updateAdminConfig).toHaveBeenCalledWith({ plexAuthEnabled: true })
    const [linkedAt] = vi.mocked(setupApi.linkPlexServer).mock.invocationCallOrder
    const [savedAt] = vi.mocked(setupApi.updateAdminConfig).mock.invocationCallOrder
    expect(linkedAt).toBeLessThan(savedAt)
    expect(within(rail()).getByRole('button', { name: 'Who can join, done' })).toHaveAccessibleDescription('Plex members, passwords')
  })

  it("says why the server wasn't linked, and saves nothing", async () => {
    vi.mocked(setupApi.linkPlexServer).mockRejectedValue(
      new SetupApiError(403, "That Plex server isn't one of yours", { code: 'not_owner' })
    )
    openAt('access', 3)
    fireEvent.click(await screen.findByRole('switch', { name: 'Plex members' }))
    await signInToPlex()

    fireEvent.click(continueButton())

    expect(await screen.findByText("That Plex server isn't one of yours. Pick one you own.")).toBeInTheDocument()
    expect(setupApi.updateAdminConfig).not.toHaveBeenCalled()
    expect(continueButton()).not.toHaveAttribute('aria-disabled')
  })

  it("says why the servers couldn't be listed again", async () => {
    openAt('access', 3)
    fireEvent.click(await screen.findByRole('switch', { name: 'Plex members' }))
    await signInToPlex()
    vi.mocked(setupApi.listPlexServers).mockRejectedValueOnce(new SetupApiError(503, 'Plex is not responding', { code: 'plex_unavailable' }))

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    expect(await screen.findByRole('alert')).toHaveTextContent("Plex isn't responding. Try again in a moment.")
  })

  it('asks for a new Plex sign-in when Plex refused it at the link', async () => {
    vi.mocked(setupApi.linkPlexServer).mockRejectedValue(new SetupApiError(400, "Plex didn't accept that sign-in", { code: 'plex_token' }))
    openAt('access', 3)
    fireEvent.click(await screen.findByRole('switch', { name: 'Plex members' }))
    await signInToPlex()

    fireEvent.click(continueButton())

    expect(await screen.findByText("Plex didn't accept that sign-in. Sign in with Plex again.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in with Plex' })).toHaveFocus()
    expect(setupApi.updateAdminConfig).not.toHaveBeenCalled()
  })

  it('marks the admin at the screen among the members, and saves the admins ticked', async () => {
    vi.mocked(setupApi.updateAdminConfig).mockResolvedValue({ config: linked({ plexAuthEnabled: true, plexAdminIds: ['101', '202'] }), warnings: [] })
    openAt('access', 3, { admin: PLEX_ADMIN, view: linked({ plexAuthEnabled: true, plexAdminIds: ['101'] }) })

    expect(await screen.findByText('You · server owner')).toBeInTheDocument()
    // Their own sign-in stays on
    expect(screen.getByRole('switch', { name: 'Plex members' })).toBeDisabled()
    expect(screen.getByText('You sign in with Plex, so this stays on.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Admin for sam' }))
    fireEvent.click(continueButton())

    await waitFor(() => expect(setupApi.updateAdminConfig).toHaveBeenCalledWith({ plexAdminIds: ['101', '202'] }))
  })

  it("says when the server's members couldn't be listed", async () => {
    vi.mocked(setupApi.getPlexMembers).mockRejectedValue(new SetupApiError(503, 'Plex is not responding', { code: 'plex_unavailable' }))
    openAt('access', 3, { admin: PLEX_ADMIN, view: linked({ plexAuthEnabled: true, plexAdminIds: ['101'] }) })

    expect(
      await screen.findByText("Couldn't load the server's members. The admins stay as they are; change them later in the Admin panel.")
    ).toBeInTheDocument()
  })
})

describe('SetupWizard: Extras', () => {
  it('saves the extras switched on, then opens Review', async () => {
    vi.mocked(setupApi.updateAdminConfig).mockResolvedValue(saved({ ...CLAIMED, chatEnabled: true }))
    openAt('extras', 4)

    fireEvent.click(await screen.findByRole('switch', { name: 'Chat' }))
    fireEvent.click(continueButton())

    expect(await screen.findByRole('heading', { level: 1, name: 'Ready to open' })).toHaveFocus()
    expect(setupApi.updateAdminConfig).toHaveBeenCalledWith({ chatEnabled: true })
    expect(within(rail()).getByRole('button', { name: 'Extras, done' })).toHaveAccessibleDescription('Chat')
  })

  it('checks a GIPHY key', async () => {
    vi.mocked(setupApi.testConnection).mockResolvedValue({ ok: true })
    openAt('extras', 4)
    fireEvent.click(await screen.findByRole('switch', { name: 'Chat' }))
    fireEvent.change(screen.getByLabelText('GIPHY API key'), { target: { value: KEY } })

    fireEvent.click(screen.getByRole('button', { name: 'Check key' }))

    expect(setupApi.testConnection).toHaveBeenCalledWith('giphy', { giphyApiKey: KEY }, expect.any(AbortSignal))
    expect(await screen.findByText('Key accepted')).toBeInTheDocument()
  })

  it("says what was saved but won't work yet", async () => {
    vi.mocked(setupApi.updateAdminConfig).mockResolvedValue({
      config: configView({ ...CLAIMED, chatEnabled: true }),
      warnings: [{ code: 'feedback_unavailable', message: 'Feedback needs an ntfy address and topic' }],
    })
    openAt('extras', 4)

    fireEvent.click(await screen.findByRole('switch', { name: 'Chat' }))
    fireEvent.click(continueButton())

    expect(await screen.findByText('Saved. Feedback sends nothing until it has an ntfy address and topic.')).toBeInTheDocument()
  })
})
