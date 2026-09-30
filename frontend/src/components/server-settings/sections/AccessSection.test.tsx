import { describe, it, expect } from 'vitest'
import { useState, type ReactNode } from 'react'
import { render, screen, fireEvent } from '@/test/utils'
import { settingsState } from '@/test/settingsFixtures'
import type { PlexMember } from '@/types/setup'
import { setField, type SettingsState } from '../model/configDraft'
import type { SectionErrors } from '../model/validation'
import { AccessSection } from './AccessSection'

const MEMBERS: PlexMember[] = [
  { plexId: '1', username: 'jon', managed: false, owner: true, admin: true },
  { plexId: '2', username: 'sam', managed: false, owner: false, admin: false },
]

function Harness({
  initial,
  adminSignIn,
  errors = {},
  members = MEMBERS,
  plexConnect,
  linkedServer,
  showHouseRules,
}: {
  initial: SettingsState
  adminSignIn: 'plex' | 'password'
  errors?: SectionErrors
  members?: readonly PlexMember[] | 'loading' | 'failed'
  plexConnect?: ReactNode
  linkedServer?: ReactNode
  showHouseRules?: boolean
}) {
  const [state, setState] = useState(initial)
  return (
    <AccessSection
      state={state}
      errors={errors}
      idPrefix="t"
      onField={(field, value) => setState((s) => ({ ...s, draft: setField(s.draft, field, value) }))}
      adminSignIn={adminSignIn}
      selfPlexId="1"
      members={members}
      plexConnect={plexConnect}
      linkedServer={linkedServer}
      showHouseRules={showHouseRules}
    />
  )
}

const plexAdmin = () =>
  settingsState({ plexAuthEnabled: true, plexServerMachineId: 'home', plexAdminIds: ['1'] }, {}, { plexServerName: 'Home Server' })

const passwordAdmin = () => settingsState({ localAuthEnabled: true, adminUsername: 'jon', adminPassword: { set: true } })

describe('AccessSection', () => {
  describe('for an admin who signs in with Plex', () => {
    it('keeps Plex members on and says why', () => {
      render(<Harness initial={plexAdmin()} adminSignIn="plex" />)

      const plex = screen.getByRole('switch', { name: 'Plex members' })
      expect(plex).toBeDisabled()
      expect(plex).toHaveAttribute('aria-checked', 'true')
      expect(plex).toHaveAccessibleDescription('Everyone you share Home Server with can sign in with their Plex account.')
      expect(screen.getByText('You sign in with Plex, so this stays on.')).toBeInTheDocument()
      expect(screen.getByRole('switch', { name: 'Username and password' })).toBeEnabled()
    })

    it('offers an optional admin login of their own and a guest login once passwords are on', () => {
      render(<Harness initial={plexAdmin()} adminSignIn="plex" />)

      fireEvent.click(screen.getByRole('switch', { name: 'Username and password' }))

      expect(screen.getByRole('heading', { level: 3, name: 'Admin login optional' })).toBeInTheDocument()
      expect(screen.getByRole('heading', { level: 3, name: 'Guest login optional' })).toBeInTheDocument()
      expect(screen.getAllByLabelText('Username').map((input) => (input as HTMLInputElement).value)).toEqual(['admin', 'viewer'])
      expect(screen.getByRole('button', { name: 'Show admin password' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Show guest password' })).toBeInTheDocument()
    })

    it('warns when every member would join as an admin', () => {
      render(<Harness initial={plexAdmin()} adminSignIn="plex" />)

      expect(screen.getByRole('radio', { name: 'Viewer' })).toBeChecked()
      fireEvent.click(screen.getByRole('radio', { name: 'Admin' }))

      expect(screen.getByText('Every member of Home Server will be an admin, including people you share it with later.')).toBeInTheDocument()
    })

    it("ticks admins from the server's members", () => {
      render(<Harness initial={plexAdmin()} adminSignIn="plex" />)

      const sam = screen.getByRole('checkbox', { name: 'Admin for sam' })
      expect(screen.getByText('You · server owner')).toBeInTheDocument()
      fireEvent.click(sam)

      expect(sam).toBeChecked()
    })

    it("says so when the members couldn't be loaded, or are loading", () => {
      const { unmount } = render(<Harness initial={plexAdmin()} adminSignIn="plex" members="failed" />)
      expect(screen.getByText(/Couldn't load the server's members/)).toBeInTheDocument()
      unmount()

      render(<Harness initial={plexAdmin()} adminSignIn="plex" members="loading" />)
      expect(screen.getByText("Loading the server's members…")).toBeInTheDocument()
    })
  })

  describe('for an admin who signs in with a password', () => {
    it('keeps passwords on, names their own login, and offers the guest login', () => {
      render(<Harness initial={passwordAdmin()} adminSignIn="password" />)

      const local = screen.getByRole('switch', { name: 'Username and password' })
      expect(local).toBeDisabled()
      expect(screen.getByText('You sign in with a password, so this stays on.')).toBeInTheDocument()
      expect(screen.getByText('jon, the account you sign in with.')).toBeInTheDocument()
      // Only the guest login is edited here
      expect(screen.getAllByLabelText('Username')).toHaveLength(1)
      expect(screen.getByRole('switch', { name: 'Plex members' })).toBeEnabled()
    })

    it('shows the Plex sign-in slot and its error while no server is linked', () => {
      render(
        <Harness
          initial={passwordAdmin()}
          adminSignIn="password"
          plexConnect={<button type="button" id="t-plex-link">Sign in with Plex</button>}
          errors={{ plexLink: 'Sign in with Plex to choose the server, or switch Plex members off.' }}
        />
      )

      fireEvent.click(screen.getByRole('switch', { name: 'Plex members' }))

      expect(screen.getByRole('button', { name: 'Sign in with Plex' })).toHaveAttribute('id', 't-plex-link')
      expect(screen.getByRole('alert')).toHaveTextContent('Sign in with Plex to choose the server, or switch Plex members off.')
      expect(screen.queryByRole('radio', { name: 'Viewer' })).not.toBeInTheDocument()
    })
  })

  it('shows what it is given for a linked server only while one is linked', () => {
    const { unmount } = render(<Harness initial={plexAdmin()} adminSignIn="plex" linkedServer={<button type="button">Re-link Plex</button>} />)
    expect(screen.getByRole('button', { name: 'Re-link Plex' })).toBeInTheDocument()
    unmount()

    render(
      <Harness
        initial={settingsState({ plexAuthEnabled: true, localAuthEnabled: true, adminPassword: { set: true } })}
        adminSignIn="password"
        linkedServer={<button type="button">Re-link Plex</button>}
      />
    )
    expect(screen.queryByRole('button', { name: 'Re-link Plex' })).not.toBeInTheDocument()
  })

  it("puts the logins one under the other in a narrow window, or in a narrow Server tab", () => {
    render(<Harness initial={passwordAdmin()} adminSignIn="password" />)
    const guest = screen.getByRole('heading', { name: /Guest login/ }).parentElement!
    const columns = guest.querySelector('.grid')
    expect(columns).toHaveClass('grid-cols-2', 'max-[760px]:grid-cols-1', '@max-[34rem]/server:grid-cols-1')
  })

  it('shows the house rules unless told not to', () => {
    const { unmount } = render(<Harness initial={plexAdmin()} adminSignIn="plex" />)

    const channel = screen.getByRole('switch', { name: 'Anyone can change the live channel' })
    fireEvent.click(channel)
    expect(channel).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: 'Show what everyone is watching' })).toBeInTheDocument()
    unmount()

    render(<Harness initial={plexAdmin()} adminSignIn="plex" showHouseRules={false} />)
    expect(screen.queryByRole('switch', { name: 'Anyone can change the live channel' })).not.toBeInTheDocument()
  })
})
