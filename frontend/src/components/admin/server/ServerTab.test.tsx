import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@/test/utils'
import { toast } from 'sonner'
import * as plexAuth from '@/services/plexAuth'
import * as setupApi from '@/services/setupApi'
import { SetupApiError } from '@/services/setupApi'
import { useAuthStore } from '@/stores/authStore'
import { configView } from '@/test/settingsFixtures'
import { sessionToken } from '@/test/setupWizard'
import type { ConfigValues, ConfigView, PlexServersResponse } from '@/types/setup'
import { ServerTab } from './ServerTab'

vi.mock('@/services/setupApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/setupApi')>()),
  getAdminConfig: vi.fn(),
  updateAdminConfig: vi.fn(),
  testConnection: vi.fn(),
  getPlexMembers: vi.fn(),
  listPlexServers: vi.fn(),
  linkPlexServer: vi.fn(),
}))

// The popup and the redirect are faked; the flow around them is real
vi.mock('@/services/plexAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/plexAuth')>()),
  authenticateWithPlex: vi.fn(),
  authenticateWithPlexRedirect: vi.fn(),
  openPlexAuthWindow: vi.fn(),
  finishPlexRedirect: vi.fn(),
}))

const device = vi.hoisted(() => ({ installed: false }))
vi.mock('@/lib/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/platform')>()),
  isStandalone: () => device.installed,
  isIOS: () => false,
}))

vi.mock('@/hooks/useTVMode', () => ({ useTVMode: vi.fn(() => false) }))

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), warning: vi.fn(), error: vi.fn(), dismiss: vi.fn() }),
}))

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const STASH_KEY = 'channel-club:server-tab-stash'
const plexWindow = { closed: false, close: vi.fn() } as unknown as Window
const SERVERS: PlexServersResponse = {
  account: { username: 'jon' },
  servers: [
    { machineId: 'home', name: 'Home Server', online: true, memberCount: 6 },
    { machineId: 'cabin', name: 'Cabin NAS', online: true, memberCount: 1 },
  ],
}
const LINKED: Partial<ConfigValues> = {
  plexAuthEnabled: true,
  plexServerMachineId: 'home',
  plexServerToken: { set: true },
  plexAdminIds: ['101'],
}

function signedIn(claims: Record<string, unknown>) {
  useAuthStore.setState({ token: sessionToken({ role: 'admin', ...claims }), role: 'admin', isAuthenticated: true })
}

async function renderTab(view: ConfigView = configView({ localAuthEnabled: true, adminPassword: { set: true } })) {
  vi.mocked(setupApi.getAdminConfig).mockResolvedValue(view)
  render(<ServerTab />)
  await screen.findByRole('heading', { level: 2, name: 'Channels' })
}

const section = (name: string) => screen.getByRole('region', { name })
const saveButton = (name: string) => screen.getByRole('button', { name: `Save ${name}` })

async function signInToPlex() {
  vi.mocked(plexAuth.openPlexAuthWindow).mockReturnValue(plexWindow)
  vi.mocked(plexAuth.authenticateWithPlex).mockResolvedValue('tok-1')
  vi.mocked(setupApi.listPlexServers).mockResolvedValue(SERVERS)
  fireEvent.click(screen.getByRole('button', { name: 'Sign in with Plex' }))
  await screen.findByText('Signed in to Plex as jon')
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  device.installed = false
  signedIn({ sub: 'admin' })
  vi.mocked(setupApi.getPlexMembers).mockResolvedValue([
    { plexId: '101', username: 'jon', managed: false, owner: true, admin: true },
    { plexId: '202', username: 'sam', managed: false, owner: false, admin: false },
  ])
})

describe('ServerTab', () => {
  it('shows each part of the settings under its own heading, with its own Save', async () => {
    await renderTab()

    for (const name of ['Channels', 'Who can join', 'Extras', 'Advanced']) {
      expect(section(name)).toBeInTheDocument()
    }
    // The cards sit a level under their part's heading
    expect(screen.getByRole('heading', { level: 3, name: 'Dispatcharr' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 4, name: /Guest login/ })).toBeInTheDocument()
    for (const name of ['channels', 'who can join', 'extras', 'advanced settings']) {
      expect(saveButton(name)).toHaveAttribute('aria-disabled', 'true')
    }
    // House rules stay on the People tab
    expect(screen.queryByText('House rules')).not.toBeInTheDocument()
    expect(screen.getByText('/data/settings.json')).toBeInTheDocument()
  })

  it('saves only the part asked, says so, and leaves the other changes unsaved', async () => {
    vi.mocked(setupApi.updateAdminConfig).mockResolvedValue({ config: configView({ chatEnabled: true }), warnings: [] })
    await renderTab()

    fireEvent.click(within(section('Extras')).getByRole('switch', { name: 'Chat' }))
    fireEvent.change(screen.getByLabelText(/Log level/), { target: { value: 'DEBUG' } })
    expect(within(section('Extras')).getByText('Unsaved changes')).toBeInTheDocument()
    fireEvent.click(saveButton('extras'))

    expect(await within(section('Extras')).findByText('Saved')).toBeInTheDocument()
    expect(setupApi.updateAdminConfig).toHaveBeenCalledExactlyOnceWith({ chatEnabled: true })
    expect(saveButton('extras')).toHaveAttribute('aria-disabled', 'true')
    expect(within(section('Advanced')).getByText('Unsaved changes')).toBeInTheDocument()
    expect(saveButton('advanced settings')).not.toHaveAttribute('aria-disabled')
  })

  it('saves nothing when nothing changed', async () => {
    await renderTab()

    fireEvent.click(saveButton('channels'))

    expect(setupApi.updateAdminConfig).not.toHaveBeenCalled()
    // Nor checks it: no source is on, but nothing asked for one
    expect(within(section('Channels')).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('checks a part before saving it, and focuses what to fix', async () => {
    await renderTab()

    fireEvent.click(within(section('Channels')).getByRole('switch', { name: 'Dispatcharr' }))
    fireEvent.click(saveButton('channels'))

    const address = screen.getByLabelText('Address')
    await waitFor(() => expect(address).toHaveFocus())
    expect(address).toHaveAccessibleDescription(expect.stringContaining('Enter the full address'))
    expect(setupApi.updateAdminConfig).not.toHaveBeenCalled()
  })

  it("puts the server's refusal on the setting, or on the part as a whole", async () => {
    await renderTab()
    fireEvent.change(screen.getByLabelText(/Seconds kept for clipping/), { target: { value: '20' } })

    vi.mocked(setupApi.updateAdminConfig).mockRejectedValueOnce(
      new SetupApiError(422, 'Keep segments short', { code: 'segment_too_long', fieldErrors: { highlightSegmentSeconds: 'Keep segments short' } })
    )
    fireEvent.click(saveButton('advanced settings'))
    const segment = screen.getByLabelText(/Recording segment length/)
    await waitFor(() => expect(segment).toHaveFocus())
    expect(segment).toHaveAccessibleDescription(expect.stringContaining('Keep segments no longer than the seconds kept for clipping.'))

    vi.mocked(setupApi.updateAdminConfig).mockRejectedValueOnce(new SetupApiError(409, 'Set by LOG_LEVEL', { code: 'locked' }))
    fireEvent.click(saveButton('advanced settings'))
    expect(await within(section('Advanced')).findByRole('alert')).toHaveTextContent(
      "Part of this is now set by the server's environment. Reload the page to see what changed."
    )
  })

  it("tells an admin who isn't one any more", async () => {
    await renderTab()
    fireEvent.click(within(section('Extras')).getByRole('switch', { name: 'Chat' }))
    vi.mocked(setupApi.updateAdminConfig).mockRejectedValueOnce(new SetupApiError(403, 'Admin access required'))

    fireEvent.click(saveButton('extras'))

    expect(await within(section('Extras')).findByRole('alert')).toHaveTextContent("Only an admin can change the server's settings.")
  })

  it("says what a saved setting still needs to work", async () => {
    vi.mocked(setupApi.updateAdminConfig).mockResolvedValue({
      config: configView({ ntfyEnabled: true }),
      warnings: [{ code: 'feedback_unavailable', message: 'Feedback needs an ntfy address and topic' }],
    })
    await renderTab(configView({ ntfyUrl: 'https://ntfy.sh', ntfyTopic: 'club' }))

    fireEvent.click(within(section('Extras')).getByRole('switch', { name: 'Feedback' }))
    fireEvent.click(saveButton('extras'))

    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith('Saved. Feedback sends nothing until it has an ntfy address and topic.')
    )
  })

  it('shows what the environment sets as locked, and leaves it out of a save', async () => {
    vi.mocked(setupApi.updateAdminConfig).mockResolvedValue({ config: configView(), warnings: [] })
    await renderTab(
      configView(
        { dispatcharrUrl: 'https://tv.example.com', dispatcharrApiKey: { set: true } },
        { locked: { dispatcharrUrl: ['DISPATCHARR_URL'], dispatcharrApiKey: ['DISPATCHARR_URL'] } }
      )
    )

    const address = screen.getByLabelText('Address')
    expect(address).toHaveAttribute('readonly')
    expect(address).toHaveAccessibleDescription(expect.stringContaining('DISPATCHARR_URL'))
    expect(within(section('Channels')).getByRole('switch', { name: 'Dispatcharr' })).toBeDisabled()

    fireEvent.click(within(section('Channels')).getByRole('switch', { name: 'ErsatzTV' }))
    fireEvent.change(screen.getAllByLabelText('Address')[1], { target: { value: 'http://etv.example.com:8409' } })
    fireEvent.click(saveButton('channels'))

    await waitFor(() => expect(setupApi.updateAdminConfig).toHaveBeenCalledExactlyOnceWith({ ersatztvBaseUrl: 'http://etv.example.com:8409' }))
  })

  it('tests a connection with the values shown', async () => {
    vi.mocked(setupApi.testConnection).mockResolvedValue({ ok: true, counts: { channels: 37, groups: 4 } })
    await renderTab(configView({ dispatcharrUrl: 'https://tv.example.com', dispatcharrApiKey: { set: true } }))

    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))

    expect(await screen.findByText('This server reached Dispatcharr')).toBeInTheDocument()
    expect(setupApi.testConnection).toHaveBeenCalledWith('dispatcharr', { dispatcharrUrl: 'https://tv.example.com' }, expect.any(AbortSignal))
  })

  it("says when the settings didn't load, and tries again", async () => {
    vi.mocked(setupApi.getAdminConfig).mockRejectedValueOnce(new Error('Server unreachable')).mockResolvedValue(configView())
    render(<ServerTab />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Server unreachable')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('heading', { level: 2, name: 'Channels' })).toBeInTheDocument()
  })

  describe('Plex', () => {
    it('Re-link Plex signs in, lists the servers and links the one picked', async () => {
      signedIn({ sub: 'jon', plex_id: '101' })
      vi.mocked(setupApi.linkPlexServer).mockResolvedValue({
        config: configView({ ...LINKED, plexServerMachineId: 'cabin' }, { plexServerName: 'Cabin NAS' }),
        warnings: [],
      })
      await renderTab(configView(LINKED, { plexServerName: 'Home Server' }))
      expect(screen.getByText('Home Server')).toBeInTheDocument()
      expect(await screen.findByText('You · server owner')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Re-link Plex' }))
      await signInToPlex()
      fireEvent.click(screen.getByRole('radio', { name: /Cabin NAS/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Link Cabin NAS' }))

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Linked to Cabin NAS'))
      expect(setupApi.linkPlexServer).toHaveBeenCalledWith({ authToken: 'tok-1', machineId: 'cabin' })
      expect(screen.getByRole('button', { name: 'Re-link Plex' })).toHaveFocus()
      expect(screen.queryByText('Signed in to Plex as jon')).not.toBeInTheDocument()
      // The new server's members
      await waitFor(() => expect(setupApi.getPlexMembers).toHaveBeenCalledTimes(2))
    })

    it("says why a server couldn't be linked again, and Cancel re-link lets it go", async () => {
      signedIn({ sub: 'jon', plex_id: '101' })
      vi.mocked(setupApi.linkPlexServer).mockRejectedValue(new SetupApiError(403, 'Not yours', { code: 'not_owner' }))
      await renderTab(configView(LINKED, { plexServerName: 'Home Server' }))

      fireEvent.click(screen.getByRole('button', { name: 'Re-link Plex' }))
      await signInToPlex()
      fireEvent.click(screen.getByRole('button', { name: 'Link Home Server' }))

      expect(await within(section('Who can join')).findByRole('alert')).toHaveTextContent("That Plex server isn't one of yours. Pick one you own.")
      fireEvent.click(screen.getByRole('button', { name: 'Cancel re-link' }))
      expect(screen.getByRole('button', { name: 'Re-link Plex' })).toBeInTheDocument()
      expect(within(section('Who can join')).queryByRole('alert')).not.toBeInTheDocument()
    })

    it('names its own Cancel apart from the Plex sign-in Cancel, and stops the sign-in when used', async () => {
      signedIn({ sub: 'jon', plex_id: '101' })
      vi.mocked(plexAuth.openPlexAuthWindow).mockReturnValue(plexWindow)
      let plexSignal: AbortSignal | undefined
      vi.mocked(plexAuth.authenticateWithPlex).mockImplementation((_popup, signal) => {
        plexSignal = signal
        return new Promise(() => {})
      })
      await renderTab(configView(LINKED, { plexServerName: 'Home Server' }))

      fireEvent.click(screen.getByRole('button', { name: 'Re-link Plex' }))
      fireEvent.click(screen.getByRole('button', { name: 'Sign in with Plex' }))

      expect(await screen.findByRole('button', { name: 'Waiting for Plex...' })).toBeDisabled()
      expect(screen.getAllByRole('button', { name: 'Cancel' })).toHaveLength(1)
      fireEvent.click(screen.getByRole('button', { name: 'Cancel re-link' }))
      expect(screen.getByRole('button', { name: 'Re-link Plex' })).toBeInTheDocument()
      expect(plexSignal?.aborted).toBe(true)
    })

    it('offers no Re-link while the environment sets sign-in', async () => {
      await renderTab(configView(LINKED, { plexServerName: 'Home Server', locked: { plexAuthEnabled: ['PLEX_AUTH_ENABLED'] } }))
      expect(screen.queryByRole('button', { name: 'Re-link Plex' })).not.toBeInTheDocument()
    })

    it('links the server picked when a password admin saves Plex members on', async () => {
      vi.mocked(setupApi.linkPlexServer).mockResolvedValue({
        config: configView({ ...LINKED, plexAuthEnabled: false, localAuthEnabled: true }, { plexServerName: 'Home Server' }),
        warnings: [],
      })
      vi.mocked(setupApi.updateAdminConfig).mockResolvedValue({
        config: configView({ ...LINKED, localAuthEnabled: true }, { plexServerName: 'Home Server' }),
        warnings: [],
      })
      await renderTab()

      fireEvent.click(within(section('Who can join')).getByRole('switch', { name: 'Plex members' }))
      await signInToPlex()
      fireEvent.click(saveButton('who can join'))

      await waitFor(() => expect(setupApi.updateAdminConfig).toHaveBeenCalledExactlyOnceWith({ plexAuthEnabled: true }))
      expect(setupApi.linkPlexServer).toHaveBeenCalledWith({ authToken: 'tok-1', machineId: 'home' })
      expect(vi.mocked(setupApi.linkPlexServer).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(setupApi.updateAdminConfig).mock.invocationCallOrder[0]
      )
    })

    it('keeps the unsaved changes and Re-link while an installed app goes to Plex', async () => {
      device.installed = true
      await renderTab(configView(LINKED, { plexServerName: 'Home Server' }))
      fireEvent.click(within(section('Extras')).getByRole('switch', { name: 'Chat' }))

      fireEvent.click(screen.getByRole('button', { name: 'Re-link Plex' }))
      fireEvent.click(screen.getByRole('button', { name: 'Sign in with Plex' }))

      await waitFor(() => expect(plexAuth.authenticateWithPlexRedirect).toHaveBeenCalledWith(expect.any(AbortSignal), '/'))
      expect(JSON.parse(sessionStorage.getItem(STASH_KEY) ?? 'null')).toEqual({
        draft: { values: { chatEnabled: true }, sources: {} },
        relinking: true,
      })
    })

    it('comes back from Plex as it was, and finishes the sign-in', async () => {
      sessionStorage.setItem(STASH_KEY, JSON.stringify({ draft: { values: { chatEnabled: true }, sources: {} }, relinking: true }))
      sessionStorage.setItem(plexAuth.PLEX_PENDING_PIN_KEY, '42')
      vi.mocked(plexAuth.finishPlexRedirect).mockResolvedValue('tok-1')
      vi.mocked(setupApi.listPlexServers).mockResolvedValue(SERVERS)
      await renderTab(configView(LINKED, { plexServerName: 'Home Server' }))

      expect(await screen.findByText('Signed in to Plex as jon')).toBeInTheDocument()
      expect(plexAuth.finishPlexRedirect).toHaveBeenCalledWith(42, expect.any(AbortSignal))
      expect(within(section('Extras')).getByText('Unsaved changes')).toBeInTheDocument()
      // Read once: a reload doesn't bring it back
      expect(sessionStorage.getItem(STASH_KEY)).toBeNull()
    })
  })
})
