import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen } from '@/test/utils'
import { useSettingsStore } from '@/stores/settingsStore'

const layout = vi.hoisted(() => ({ mode: 'desktop' as 'phone' | 'tablet' | 'desktop' }))
vi.mock('@/hooks/useLayoutMode', () => ({ useLayoutMode: () => layout.mode }))
vi.mock('./GifPicker', () => ({ GifPicker: () => <div data-testid="gif-picker" /> }))

import { GifButton } from './GifButton'

describe('GifButton', () => {
  beforeEach(() => {
    layout.mode = 'desktop'
    useSettingsStore.setState({ serverFeatures: { chat: true, gif: true } })
  })

  it('stays hidden until connection_ack says GIFs are on, without asking /gif/feature', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    useSettingsStore.setState({ serverFeatures: null })
    render(<GifButton onSelect={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Send GIF' })).not.toBeInTheDocument()

    act(() => useSettingsStore.getState().setServerFeatures({ chat: true, gif: true }))

    expect(screen.getByRole('button', { name: 'Send GIF' })).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('stays hidden when the server says GIFs are off', () => {
    useSettingsStore.setState({ serverFeatures: { chat: true, gif: false } })
    render(<GifButton onSelect={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Send GIF' })).not.toBeInTheDocument()
  })

  it.each(['desktop', 'phone'] as const)('is a quiet ghost icon on %s, so it never outshines Send', async (mode) => {
    layout.mode = mode
    render(<GifButton onSelect={vi.fn()} />)

    const trigger = await screen.findByRole('button', { name: 'Send GIF' })

    expect(trigger).toHaveAttribute('data-variant', 'ghost')
    expect(trigger).not.toHaveClass('bg-primary')
    // A 44px target on touch screens, like Send beside it
    expect(trigger).toHaveClass('pointer-coarse:size-11')
  })

  // Chat in the fullscreen player hands it the player: anywhere else the
  // picker would open hidden behind fullscreen
  it.each(['desktop', 'phone'] as const)('opens the picker in the element it is given on %s', async (mode) => {
    layout.mode = mode
    const shell = document.createElement('div')
    document.body.appendChild(shell)
    try {
      render(<GifButton onSelect={vi.fn()} container={shell} />)

      fireEvent.click(await screen.findByRole('button', { name: 'Send GIF' }))

      expect(shell).toContainElement(screen.getByTestId('gif-picker'))
    } finally {
      shell.remove()
    }
  })
})
