import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { fireEvent, render, screen } from '@/test/utils'

const layout = vi.hoisted(() => {
  // GifButton reads the build-time flag when it loads
  vi.stubEnv('VITE_GIF_ENABLED', 'true')
  return { mode: 'desktop' as 'phone' | 'tablet' | 'desktop' }
})
vi.mock('@/hooks/useLayoutMode', () => ({ useLayoutMode: () => layout.mode }))
vi.mock('@/services/gifApi', () => ({ getGifFeatureEnabled: vi.fn().mockResolvedValue(true) }))
vi.mock('./GifPicker', () => ({ GifPicker: () => <div data-testid="gif-picker" /> }))

import { GifButton } from './GifButton'

afterAll(() => {
  vi.unstubAllEnvs()
})

describe('GifButton', () => {
  beforeEach(() => {
    layout.mode = 'desktop'
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
