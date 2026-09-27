import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@/test/utils'
import { ChannelFilterBar } from './ChannelFilterBar'
import { useChannelPrefsStore } from '@/stores/channelPrefsStore'

describe('ChannelFilterBar touch targets', () => {
  afterEach(() => {
    cleanup()
    useChannelPrefsStore.getState().clearFilter()
  })

  it('grows the search box and the chips to 44px on touch only, keeping their mouse sizes', () => {
    render(<ChannelFilterBar layout="inline" />)

    const search = screen.getByRole('textbox', { name: 'Search channels and shows' })
    expect(search).toHaveClass('pointer-coarse:h-11')
    for (const name of ['All', 'Favourites', 'Recent']) {
      const chip = screen.getByRole('button', { name })
      expect(chip).toHaveClass('h-7', 'pointer-coarse:h-11')
    }
  })

  it('gives the clear button a bigger target on touch', () => {
    useChannelPrefsStore.getState().setFilterQuery('news')
    render(<ChannelFilterBar layout="inline" />)

    expect(screen.getByRole('button', { name: 'Clear search' })).toHaveClass(
      'h-7',
      'w-7',
      'pointer-coarse:h-9',
      'pointer-coarse:w-9'
    )
  })
})
