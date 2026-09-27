import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { render, screen } from '@/test/utils'

const layout = vi.hoisted(() => {
  // GifButton reads the build-time flag when it loads
  vi.stubEnv('VITE_GIF_ENABLED', 'true')
  return { mode: 'desktop' as 'phone' | 'tablet' | 'desktop' }
})
vi.mock('@/hooks/useLayoutMode', () => ({ useLayoutMode: () => layout.mode }))
vi.mock('@/services/gifApi', () => ({ getGifFeatureEnabled: vi.fn().mockResolvedValue(true) }))
vi.mock('./GifPicker', () => ({ GifPicker: () => null }))

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
  })
})
