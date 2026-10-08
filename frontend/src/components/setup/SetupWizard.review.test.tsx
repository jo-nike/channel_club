import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import * as plexAuth from '@/services/plexAuth'
import * as setupApi from '@/services/setupApi'
import { SetupApiError } from '@/services/setupApi'
import { useAuthStore } from '@/stores/authStore'
import { configView } from '@/test/settingsFixtures'
import { focusedStepHeading, pending, renderWizard } from '@/test/setupWizard'
import type { ConfigUpdate, ConfigValues, ConfigView, SetupFacts } from '@/types/setup'
import type { StepId } from './steps'
import type { WizardAdmin } from './wizardReducer'

// Review, Open Channel Club and the On air screen

vi.mock('@/services/setupApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/setupApi')>()),
  completeSetup: vi.fn(),
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

const PROGRESS_KEY = 'channel-club:setup-progress'
const PASSWORD_ADMIN: WizardAdmin = { signIn: 'password', username: 'sam', plexId: null }
const PLEX_ADMIN: WizardAdmin = { signIn: 'plex', username: 'jon', plexId: '101' }
/** A club set up as far as Review: a password admin and Dispatcharr saved */
const READY: Partial<ConfigValues> = {
  localAuthEnabled: true,
  adminUsername: 'sam',
  adminPassword: { set: true },
  dispatcharrUrl: 'https://tv.example.com',
  dispatcharrApiKey: { set: true },
}
// A stand-in for an API key (spaced, so no scanner takes it for a real one)
const KEY = 'api key one'
const FACTS: SetupFacts = {
  dispatcharrChannels: 37,
  ersatztvChannels: null,
  plexServerName: null,
  features: { chat: true, gifs: false, clips: false, nhl: false, feedback: false },
}

const rail = () => screen.getByRole('navigation', { name: 'Setup steps' })
const openButton = () => screen.getByRole('button', { name: 'Open Channel Club' })

/** A claimed club opened at `step`, every step reached, with these settings on the server. */
function openAt(step: StepId, { admin = PASSWORD_ADMIN, view = configView(READY) }: { admin?: WizardAdmin; view?: ConfigView } = {}) {
  localStorage.setItem(PROGRESS_KEY, JSON.stringify({ step, reached: 5 }))
  vi.mocked(setupApi.getAdminConfig).mockResolvedValue(view)
  return renderWizard({ setupState: 'claimed', admin })
}

async function openReview(options?: Parameters<typeof openAt>[1]) {
  const router = openAt('review', options)
  await screen.findByText('Handled for you')
  return router
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  useAuthStore.setState({ token: null, role: null, username: null, isAuthenticated: false, isInitializing: false })
  window.scrollTo = vi.fn()
  vi.mocked(setupApi.completeSetup).mockResolvedValue(FACTS)
  vi.mocked(setupApi.getPlexMembers).mockResolvedValue([])
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SetupWizard: Review', () => {
  it('sums up each step, with Edit for all but the account', async () => {
    await openReview()

    const summary = screen.getByText('Username and password, as sam').closest('dl') as HTMLElement
    expect(within(summary).getByText('Your account')).toBeInTheDocument()
    expect(within(summary).getByText('Dispatcharr · not tested')).toBeInTheDocument()
    expect(within(summary).getByText('Admin login: sam')).toBeInTheDocument()
    expect(within(summary).getByText('No guest login')).toBeInTheDocument()
    expect(within(summary).getByText('None')).toBeInTheDocument()
    expect(within(summary).queryByRole('button', { name: 'Edit Your account' })).not.toBeInTheDocument()

    fireEvent.click(within(summary).getByRole('button', { name: 'Edit Who can join' }))

    await focusedStepHeading('Who can join?')
  })

  it('reports how a source tested with the key its step then saved', async () => {
    vi.mocked(setupApi.testConnection).mockResolvedValue({ ok: true, counts: { channels: 37, groups: 4 } })
    vi.mocked(setupApi.updateAdminConfig).mockResolvedValue({ config: configView(READY), warnings: [] })
    openAt('sources', { view: configView({ ...READY, dispatcharrApiKey: { set: false } }) })

    fireEvent.change(await screen.findByLabelText('API key'), { target: { value: KEY } })
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))
    await screen.findByText('This server reached Dispatcharr')
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { level: 1, name: 'Who can join?' })
    fireEvent.click(within(rail()).getByRole('button', { name: 'Review' }))

    const summary = (await screen.findByText('Username and password, as sam')).closest('dl') as HTMLElement
    expect(within(summary).getByText('Dispatcharr · 37 channels')).toBeInTheDocument()
  })

  it("names a Plex admin's server", async () => {
    await openReview({
      admin: PLEX_ADMIN,
      view: configView({ ...READY, plexAuthEnabled: true, plexServerMachineId: 'home', plexAdminIds: ['101'] }, { plexServerName: 'Home Server' }),
    })

    expect(screen.getByText('Plex, signed in as jon')).toBeInTheDocument()
    expect(screen.getByText('Server: Home Server')).toBeInTheDocument()
    expect(screen.getByText('Plex members of Home Server join as viewers')).toBeInTheDocument()
  })

  it('says what setup handled, and where the settings are kept', async () => {
    await openReview()

    expect(screen.getByText(/Created on this server and saved with your settings/)).toBeInTheDocument()
    expect(screen.getByText('/data/settings.json')).toBeInTheDocument()
    expect(screen.queryByText('From the environment')).not.toBeInTheDocument()
  })

  it('warns when the server has nowhere to keep settings, and lists what the environment sets', async () => {
    await openReview({
      view: configView(READY, {
        storage: { settingsFile: null, signingKey: 'environment' },
        environment: [{ env: 'LOG_LEVEL', field: 'logLevel', value: 'DEBUG', secret: false }],
      }),
    })

    expect(screen.getByText(/This server has nowhere to keep settings/)).toBeInTheDocument()
    expect(screen.getByText(/in the server's environment\.$/)).toBeInTheDocument()
    expect(screen.getByText('From the environment')).toBeInTheDocument()
    expect(screen.getByText('LOG_LEVEL')).toBeInTheDocument()
    expect(screen.getByText('DEBUG')).toBeInTheDocument()
  })

  it('keeps Advanced closed until asked, and open while a setting in it has a problem', async () => {
    await openReview()
    const advanced = screen.getByRole('button', { name: 'Advanced settings' })
    expect(advanced).toHaveAttribute('aria-expanded', 'false')
    expect(advanced).toHaveAccessibleDescription(expect.stringContaining('Tuned defaults'))

    fireEvent.click(advanced)
    const casts = screen.getByLabelText(/^Casts at once/)
    fireEvent.change(casts, { target: { value: '0' } })
    fireEvent.click(openButton())

    // Checked after the steps before it, each saved in turn
    await waitFor(() => expect(screen.getByLabelText(/^Casts at once/)).toHaveFocus())
    expect(screen.getByLabelText(/^Casts at once/)).toHaveAccessibleDescription(expect.stringContaining('Use a whole number from 1 to 64.'))
    fireEvent.click(advanced)
    expect(advanced).toHaveAttribute('aria-expanded', 'true')
    expect(setupApi.updateAdminConfig).not.toHaveBeenCalled()
    expect(setupApi.completeSetup).not.toHaveBeenCalled()
  })

  it('puts Advanced back to the defaults', async () => {
    await openReview()
    fireEvent.click(screen.getByRole('button', { name: 'Advanced settings' }))
    fireEvent.change(screen.getByLabelText(/^Casts at once/), { target: { value: '12' } })

    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }))

    expect(screen.getByLabelText(/^Casts at once/)).toHaveValue('8')
  })
})

describe('SetupWizard: Open Channel Club', () => {
  it('saves what is still unsaved, in step order, then opens the club', async () => {
    const finishing = pending<SetupFacts>()
    vi.mocked(setupApi.completeSetup).mockReturnValue(finishing.promise)
    vi.mocked(setupApi.updateAdminConfig).mockImplementation(
      async (patch): Promise<ConfigUpdate> => ({ config: configView({ ...READY, ...(patch as Partial<ConfigValues>) }), warnings: [] })
    )
    openAt('extras')
    // Changed, then left through the rail without Continue
    fireEvent.click(await screen.findByRole('switch', { name: 'Chat' }))
    fireEvent.click(within(rail()).getByRole('button', { name: /^Review/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Advanced settings' }))
    fireEvent.change(screen.getByLabelText(/^Casts at once/), { target: { value: '12' } })

    fireEvent.click(openButton())

    await waitFor(() => expect(setupApi.completeSetup).toHaveBeenCalledOnce())
    expect(vi.mocked(setupApi.updateAdminConfig).mock.calls).toEqual([[{ chatEnabled: true }], [{ mediaProcessLimit: 12 }]])
    expect(screen.getByRole('button', { name: 'Opening…' })).toHaveAttribute('aria-disabled', 'true')

    await act(async () => finishing.settle(FACTS))

    await focusedStepHeading('Channel Club is open')
  })

  it('opens the first step with something to fix, focusing it', async () => {
    // Nothing saved yet: Dispatcharr starts on, with no address
    await openReview({ view: configView({ localAuthEnabled: true, adminUsername: 'sam', adminPassword: { set: true } }) })

    fireEvent.click(openButton())

    const address = await screen.findByLabelText('Address')
    expect(screen.getByRole('heading', { level: 1, name: 'Where do your channels come from?' })).toBeInTheDocument()
    expect(address).toHaveFocus()
    expect(address).toHaveAccessibleDescription(expect.stringContaining('Enter the full address'))
    expect(setupApi.completeSetup).not.toHaveBeenCalled()
  })

  it('opens the step whose save the server refused, with why', async () => {
    vi.mocked(setupApi.updateAdminConfig).mockRejectedValue(
      new SetupApiError(409, 'Set by CHAT_ENABLED', { code: 'locked', field: 'chatEnabled', env: ['CHAT_ENABLED'] })
    )
    openAt('extras')
    fireEvent.click(await screen.findByRole('switch', { name: 'Chat' }))
    fireEvent.click(within(rail()).getByRole('button', { name: /^Review/ }))
    await screen.findByText('Handled for you')

    fireEvent.click(openButton())

    expect(await screen.findByRole('heading', { level: 1, name: 'Add the extras' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent("Part of this is now set by the server's environment.")
    expect(setupApi.completeSetup).not.toHaveBeenCalled()
  })

  it("opens Who can join when the Plex server picked there can't be linked", async () => {
    vi.mocked(plexAuth.openPlexAuthWindow).mockReturnValue({ closed: false, close: vi.fn() } as unknown as Window)
    vi.mocked(plexAuth.authenticateWithPlex).mockResolvedValue('tok-1')
    vi.mocked(setupApi.listPlexServers).mockResolvedValue({
      account: { username: 'jon' },
      servers: [{ machineId: 'home', name: 'Home Server', online: true }],
    })
    vi.mocked(setupApi.linkPlexServer).mockRejectedValue(new SetupApiError(403, "That Plex server isn't one of yours", { code: 'not_owner' }))
    openAt('access')
    // Plex members on and a server picked, then on to Review without Continue
    fireEvent.click(await screen.findByRole('switch', { name: 'Plex members' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Plex' }))
    await screen.findByText('Signed in to Plex as jon')
    fireEvent.click(within(rail()).getByRole('button', { name: /^Review/ }))
    await screen.findByText('Handled for you')

    fireEvent.click(openButton())

    expect(await screen.findByRole('heading', { level: 1, name: 'Who can join?' })).toBeInTheDocument()
    expect(screen.getByText("That Plex server isn't one of yours. Pick one you own.")).toBeInTheDocument()
    expect(setupApi.linkPlexServer).toHaveBeenCalledWith({ authToken: 'tok-1', machineId: 'home' })
    expect(setupApi.completeSetup).not.toHaveBeenCalled()
  })

  it("says why setup couldn't finish", async () => {
    vi.mocked(setupApi.completeSetup).mockRejectedValue(
      new SetupApiError(409, "Sign-in is set in the server's environment", { code: 'env_managed' })
    )
    await openReview()

    fireEvent.click(openButton())

    expect(await screen.findByRole('alert')).toHaveTextContent("Sign-in is set in this server's environment, so there's nothing to set up.")
    expect(screen.getByRole('button', { name: 'Go to sign in' })).toBeInTheDocument()
    expect(openButton()).not.toHaveAttribute('aria-disabled')
  })
})

describe('SetupWizard: On air', () => {
  async function openClub() {
    const router = await openReview()
    fireEvent.click(openButton())
    await screen.findByRole('heading', { level: 1, name: 'Channel Club is open' })
    return router
  }

  it('shows the link and what is on, with every step done', async () => {
    await openClub()

    expect(screen.getByText(window.location.origin)).toBeInTheDocument()
    const facts = screen.getByRole('list', { name: "What's on" })
    expect(within(facts).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['37 channels', 'Chat on'])
    expect(within(screen.getByRole('banner')).getByText('Setup complete')).toBeInTheDocument()
    expect(within(rail()).getByRole('button', { name: 'Review, done' })).toBeDisabled()
    expect(within(rail()).getByRole('button', { name: 'Channels, done' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
    // No action bar, so nothing to keep focus clear of
    expect(document.documentElement).not.toHaveClass('setup-action-bar')
    expect(localStorage.getItem(PROGRESS_KEY)).toBeNull()
  })

  it('copies the link', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    await openClub()

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))

    expect(writeText).toHaveBeenCalledWith(window.location.origin)
    expect(await screen.findByText('Copied')).toBeInTheDocument()
  })

  it('selects the link when the clipboard is out of reach', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined })
    await openClub()

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))

    expect(await screen.findByText('Link selected, ready to copy.')).toBeInTheDocument()
    expect(window.getSelection()?.toString()).toBe(window.location.origin)
  })

  it('goes home on Start watching', async () => {
    const router = await openClub()

    fireEvent.click(screen.getByRole('button', { name: 'Start watching' }))

    expect(await screen.findByText('Home page')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
  })
})
