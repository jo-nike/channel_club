import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useRef, useState } from 'react'
import { render, screen, fireEvent, within, waitFor } from '@/test/utils'
import { useVideoKeyboardShortcuts } from '@/hooks/useVideoKeyboardShortcuts'
import { NHLScoresOverlay } from '@/components/NHLScoresOverlay'
import { useUIStore } from '@/stores/uiStore'
import { ShortcutSheet } from './ShortcutSheet'

const chat = vi.hoisted(() => ({ enabled: true }))
vi.mock('@/hooks/useChatEnabled', () => ({ useChatEnabled: () => chat.enabled }))
vi.mock('@/hooks/useNHLScores', () => ({
  useNHLScores: () => ({ data: null, isLoading: false, error: null, refetch: vi.fn() }),
}))

// The sheet as the player shell wires it: '?' opens it, portalled into the shell
function Shell() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [shell, setShell] = useState<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  useVideoKeyboardShortcuts({ containerRef, onShortcutSheet: () => setOpen(true) })
  return (
    <>
      <div
        data-testid="shell"
        ref={(node) => {
          containerRef.current = node
          setShell(node)
        }}
      />
      <button type="button">Channel 4</button>
      <ShortcutSheet open={open} onOpenChange={setOpen} container={shell} />
    </>
  )
}

// The NHL scores sit in the same shell, with an Escape listener on the document
function ShellWithScores() {
  const isNHLOverlayVisible = useUIStore((s) => s.isNHLOverlayVisible)
  return (
    <>
      <NHLScoresOverlay isVisible={isNHLOverlayVisible} />
      <Shell />
    </>
  )
}

const sheet = () => screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })
// The keys listed for an action, in order
const keysFor = (action: string) => {
  const term = screen.getByText(action, { selector: 'dt' })
  const row = term.parentElement
  if (!row) throw new Error(`no row for ${action}`)
  return within(row).getAllByText((_, element) => element?.tagName === 'KBD').map((kbd) => kbd.textContent)
}

describe('ShortcutSheet', () => {
  beforeEach(() => {
    chat.enabled = true
  })
  afterEach(() => {
    vi.restoreAllMocks()
    useUIStore.setState({ isNHLOverlayVisible: false })
  })

  it('? opens it inside the player shell, so it shows in fullscreen', () => {
    render(<Shell />)
    expect(sheet()).not.toBeInTheDocument()

    fireEvent.keyDown(window, { key: '?', shiftKey: true })

    const dialog = sheet()
    expect(dialog).toBeInTheDocument()
    expect(screen.getByTestId('shell')).toContainElement(dialog)
  })

  it('? opens it with focus on a channel button just clicked', () => {
    render(<Shell />)
    const channel = screen.getByRole('button', { name: 'Channel 4' })
    channel.focus()

    fireEvent.keyDown(channel, { key: '?', shiftKey: true })

    expect(sheet()).toBeInTheDocument()
  })

  it('Escape closes it and gives focus back', async () => {
    render(<Shell />)
    const channel = screen.getByRole('button', { name: 'Channel 4' })
    channel.focus()
    fireEvent.keyDown(channel, { key: '?', shiftKey: true })
    const dialog = sheet()
    if (!dialog) throw new Error('sheet did not open')

    fireEvent.keyDown(dialog, { key: 'Escape' })

    expect(sheet()).not.toBeInTheDocument()
    // Radix moves focus on the next tick
    await waitFor(() => expect(channel).toHaveFocus())
  })

  it('Escape closes only the sheet, not the NHL scores under it', () => {
    useUIStore.setState({ isNHLOverlayVisible: true })
    render(<ShellWithScores />)
    fireEvent.keyDown(window, { key: '?', shiftKey: true })
    const dialog = sheet()
    if (!dialog) throw new Error('sheet did not open')

    fireEvent.keyDown(dialog, { key: 'Escape' })

    expect(sheet()).not.toBeInTheDocument()
    expect(useUIStore.getState().isNHLOverlayVisible).toBe(true)
  })

  it('keys pressed inside it are not shortcuts, so ? does not stack another', () => {
    const onOpenChange = vi.fn()
    render(<ShortcutSheet open onOpenChange={onOpenChange} container={document.body} />)

    fireEvent.keyDown(screen.getByRole('dialog'), { key: '?' })

    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })

  it('lists the player, channel and panel keys', () => {
    render(<ShortcutSheet open onOpenChange={vi.fn()} container={document.body} />)

    expect(keysFor('Play or pause')).toEqual(['Space'])
    expect(keysFor('Mute or unmute')).toEqual(['M'])
    expect(keysFor('Volume up or down')).toEqual(['↑', '↓', '→', '←'])
    expect(keysFor('Fullscreen')).toEqual(['F'])
    expect(keysFor('Theater mode')).toEqual(['T'])
    expect(keysFor('Reload the stream')).toEqual(['R'])
    expect(keysFor('Channel up or down')).toEqual(['PgUp', 'PgDn', ']', '['])
    expect(keysFor('Type a channel number')).toEqual(['0–9'])
    expect(keysFor('Tune the number now')).toEqual(['Enter'])
    expect(keysFor('Last channel')).toEqual(['L'])
    expect(keysFor('Open or close chat')).toEqual(['C'])
    expect(keysFor('NHL scores')).toEqual(['N'])
    expect(keysFor('This list')).toEqual(['?'])
    expect(keysFor('Close')).toEqual(['Esc'])
  })

  it('lists X for Clip that where it is offered', () => {
    render(<ShortcutSheet open onOpenChange={vi.fn()} container={document.body} canClip />)

    expect(keysFor('Clip that: post the last 20s to chat')).toEqual(['X'])
  })

  it('leaves out X where Clip that is not offered (a TV, no Zipline or chat)', () => {
    render(<ShortcutSheet open onOpenChange={vi.fn()} container={document.body} />)

    expect(screen.queryByText(/Clip that/)).not.toBeInTheDocument()
  })

  it('groups the keys under headings', () => {
    render(<ShortcutSheet open onOpenChange={vi.fn()} container={document.body} />)

    for (const name of ['Player', 'Channels', 'Panels']) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument()
    }
  })

  it('leaves out C where chat is turned off', () => {
    chat.enabled = false
    render(<ShortcutSheet open onOpenChange={vi.fn()} container={document.body} />)

    expect(screen.queryByText('Open or close chat')).not.toBeInTheDocument()
    expect(keysFor('NHL scores')).toEqual(['N'])
  })
})
