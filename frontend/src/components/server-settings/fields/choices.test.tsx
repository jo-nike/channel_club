import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@/test/utils'
import { focusOverrides } from '@/test/focus'
import type { PlexMember, PlexServer } from '@/types/setup'
import { ChoiceCard } from './ChoiceCard'
import { PeopleAdminList } from './PeopleAdminList'
import { PlexServerPicker } from './PlexServerPicker'
import { SegmentedRadio } from './SegmentedRadio'

describe('ChoiceCard', () => {
  it('is a native radio named by its title and description, with the global focus outline', () => {
    const onChange = vi.fn()
    render(
      <fieldset>
        <ChoiceCard name="signin" value="plex" title="Plex account" description="Sign in with Plex." checked onChange={onChange} />
        <ChoiceCard name="signin" value="password" title="Username and password" description="Works without Plex." checked={false} onChange={onChange} />
      </fieldset>
    )

    const password = screen.getByRole('radio', { name: /Username and password/ })
    expect(screen.getByRole('radio', { name: /Plex account/ })).toBeChecked()
    expect(focusOverrides(password)).toEqual([])

    fireEvent.click(password)
    expect(onChange).toHaveBeenCalled()
  })
})

describe('SegmentedRadio', () => {
  const options = [
    { value: 'viewer', label: 'Viewer' },
    { value: 'admin', label: 'Admin' },
  ] as const

  it('is a group of native radios under one name, so arrow keys move between them', () => {
    render(
      <>
        <span id="role-label">New members join as</span>
        <SegmentedRadio name="role" value="viewer" options={options} onChange={vi.fn()} labelledBy="role-label" />
      </>
    )

    expect(screen.getByRole('group', { name: 'New members join as' })).toBeInTheDocument()
    const radios = screen.getAllByRole('radio')
    expect(radios.map((radio) => radio.getAttribute('name'))).toEqual(['role', 'role'])
    expect(screen.getByRole('radio', { name: 'Viewer' })).toBeChecked()
  })

  it('reports the option chosen', () => {
    const onChange = vi.fn()
    render(<SegmentedRadio name="role" value="viewer" options={options} onChange={onChange} labelledBy="x" />)

    fireEvent.click(screen.getByRole('radio', { name: 'Admin' }))

    expect(onChange).toHaveBeenCalledWith('admin')
  })

  it('draws the focus outline on the segment around the invisible radio', () => {
    render(<SegmentedRadio name="role" value="viewer" options={options} onChange={vi.fn()} labelledBy="x" />)

    const segment = screen.getByRole('radio', { name: 'Admin' }).closest('label')
    expect(segment).toHaveClass('has-focus-visible:outline-2', 'has-focus-visible:outline-ring')
    expect(screen.getByRole('radio', { name: 'Admin' })).toHaveClass('opacity-0')
  })
})

describe('PlexServerPicker', () => {
  const NOW = Date.parse('2026-09-29T12:00:00Z')
  const servers: PlexServer[] = [
    { machineId: 'home', name: 'Home Server', online: true, memberCount: 6 },
    { machineId: 'cabin', name: 'Cabin NAS', online: false, memberCount: 1, lastSeenAt: '2026-09-26T11:00:00Z' },
    { machineId: 'new', name: 'New box', online: true, memberCount: 0 },
    { machineId: 'odd', name: 'Unknown', online: false, memberCount: null, lastSeenAt: '2026-09-29T11:30:00Z' },
  ]

  afterEach(() => {
    vi.useRealTimers()
  })

  it('lists each server with its sharing, state and when an offline one was last seen', () => {
    vi.useFakeTimers({ now: NOW })
    render(
      <>
        <span id="servers-label">Your Plex server</span>
        <PlexServerPicker servers={servers} value="home" onChange={vi.fn()} name="server" labelledBy="servers-label" />
      </>
    )

    expect(screen.getByRole('radiogroup', { name: 'Your Plex server' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Home Server/ })).toBeChecked()
    expect(screen.getByText('Shared with 6 people')).toBeInTheDocument()
    expect(screen.getByText('Shared with 1 person · last seen 3 days ago')).toBeInTheDocument()
    expect(screen.getByText('Not shared yet')).toBeInTheDocument()
    expect(screen.getByText('Last seen 30 minutes ago')).toBeInTheDocument()
    expect(screen.getAllByText('Online')).toHaveLength(2)
    expect(screen.getAllByText('Offline')).toHaveLength(2)
  })

  it('reports the server picked', () => {
    const onChange = vi.fn()
    render(<PlexServerPicker servers={servers} value="home" onChange={onChange} name="server" labelledBy="x" />)

    fireEvent.click(screen.getByRole('radio', { name: /Cabin NAS/ }))

    expect(onChange).toHaveBeenCalledWith('cabin')
  })
})

describe('PeopleAdminList', () => {
  const members: PlexMember[] = [
    { plexId: '1', username: 'jon', managed: false, owner: true, admin: true },
    { plexId: '2', username: 'sam', managed: false, owner: false, admin: false },
    { plexId: '3', username: 'den-tv', managed: true, owner: false, admin: true },
  ]

  it('names each Admin tick after its person, and gives the owner none', () => {
    render(
      <>
        <span id="admins-label">Admins</span>
        <PeopleAdminList members={members} adminIds={['1', '3']} onChange={vi.fn()} labelledBy="admins-label" selfId="1" />
      </>
    )

    expect(screen.getByRole('list', { name: 'Admins' })).toBeInTheDocument()
    expect(screen.getByText('You · server owner')).toBeInTheDocument()
    expect(screen.getByText('Always admin')).toBeInTheDocument()
    expect(screen.getByText('Managed user')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Admin for jon' })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Admin for sam' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Admin for den-tv' })).toBeChecked()
  })

  it('adds and removes an id, keeping the others', () => {
    const onChange = vi.fn()
    render(<PeopleAdminList members={members} adminIds={['1', '3', 'gone']} onChange={onChange} labelledBy="x" />)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Admin for sam' }))
    expect(onChange).toHaveBeenLastCalledWith(['1', '3', 'gone', '2'])

    fireEvent.click(screen.getByRole('checkbox', { name: 'Admin for den-tv' }))
    expect(onChange).toHaveBeenLastCalledWith(['1', 'gone'])
  })
})
