import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@/test/utils'
import { CollapsibleChannelGroup } from './CollapsibleChannelGroup'
import { focusOverrides } from '@/test/focus'
import type { ChannelGroupWithChannels } from '@/types'

const mockGroup: ChannelGroupWithChannels = {
  id: 1,
  name: 'Sports',
  channelCount: 2,
  channels: [
    { id: '1', name: 'TSN', streamUrl: 'http://stream1.m3u8', guideId: '1' },
    { id: '2', name: 'Sportsnet', streamUrl: 'http://stream2.m3u8', guideId: '2' },
  ],
}

describe('CollapsibleChannelGroup', () => {
  describe('Collapsed state (default)', () => {
    it('should render group header with name and channel count', () => {
      render(
        <CollapsibleChannelGroup
          group={mockGroup}
          currentChannelId={null}
          canSelect={true}
          onSelectChannel={vi.fn()}
        />
      )

      expect(screen.getByText('Sports')).toBeInTheDocument()
      expect(screen.getByText('2')).toBeInTheDocument() // Channel count badge
    })

    it('should be collapsed by default', () => {
      render(
        <CollapsibleChannelGroup
          group={mockGroup}
          currentChannelId={null}
          canSelect={true}
          onSelectChannel={vi.fn()}
        />
      )

      // Channels should not be visible when collapsed
      expect(screen.queryByText('TSN')).not.toBeInTheDocument()
      expect(screen.queryByText('Sportsnet')).not.toBeInTheDocument()
    })

    it('should have chevron icon in default position', () => {
      const { container } = render(
        <CollapsibleChannelGroup
          group={mockGroup}
          currentChannelId={null}
          canSelect={true}
          onSelectChannel={vi.fn()}
        />
      )

      const chevron = container.querySelector('svg')
      expect(chevron).toBeInTheDocument()
      // SVG elements use className.baseVal for the class string
      const classString = chevron?.getAttribute('class') || ''
      expect(classString).not.toContain('rotate-180')
    })
  })

  describe('Expand/collapse behavior', () => {
    it('should expand when header is clicked', () => {
      render(
        <CollapsibleChannelGroup
          group={mockGroup}
          currentChannelId={null}
          canSelect={true}
          onSelectChannel={vi.fn()}
        />
      )

      fireEvent.click(screen.getByText('Sports'))

      // Channels should now be visible
      expect(screen.getByText('TSN')).toBeInTheDocument()
      expect(screen.getByText('Sportsnet')).toBeInTheDocument()
    })

    it('should collapse when header is clicked again', () => {
      render(
        <CollapsibleChannelGroup
          group={mockGroup}
          currentChannelId={null}
          canSelect={true}
          onSelectChannel={vi.fn()}
        />
      )

      // Expand
      fireEvent.click(screen.getByText('Sports'))
      expect(screen.getByText('TSN')).toBeInTheDocument()

      // Collapse
      fireEvent.click(screen.getByText('Sports'))
      expect(screen.queryByText('TSN')).not.toBeInTheDocument()
    })

    it('should rotate chevron when expanded', () => {
      const { container } = render(
        <CollapsibleChannelGroup
          group={mockGroup}
          currentChannelId={null}
          canSelect={true}
          onSelectChannel={vi.fn()}
        />
      )

      fireEvent.click(screen.getByText('Sports'))

      const chevron = container.querySelector('svg')
      // SVG elements use className.baseVal for the class string
      const classString = chevron?.getAttribute('class') || ''
      expect(classString).toContain('rotate-180')
    })
  })

  describe('forceOpen prop', () => {
    it('should be expanded when forceOpen is true', () => {
      render(
        <CollapsibleChannelGroup
          group={mockGroup}
          currentChannelId={null}
          canSelect={true}
          onSelectChannel={vi.fn()}
          forceOpen={true}
        />
      )

      // Channels should be visible due to forceOpen
      expect(screen.getByText('TSN')).toBeInTheDocument()
      expect(screen.getByText('Sportsnet')).toBeInTheDocument()
    })
  })

  describe('defaultOpen prop', () => {
    it('should start expanded', () => {
      render(
        <CollapsibleChannelGroup
          group={mockGroup}
          currentChannelId="1"
          canSelect={true}
          onSelectChannel={vi.fn()}
          defaultOpen
        />
      )

      expect(screen.getByText('TSN')).toBeInTheDocument()
      expect(screen.getByText('Sportsnet')).toBeInTheDocument()
    })

    it('should still collapse when the header is clicked, and stay collapsed on re-render', () => {
      const { rerender } = render(
        <CollapsibleChannelGroup
          group={mockGroup}
          currentChannelId="1"
          canSelect={true}
          onSelectChannel={vi.fn()}
          defaultOpen
        />
      )

      fireEvent.click(screen.getByText('Sports'))
      expect(screen.queryByText('TSN')).not.toBeInTheDocument()

      // Only the first render reads defaultOpen
      rerender(
        <CollapsibleChannelGroup
          group={mockGroup}
          currentChannelId="1"
          canSelect={true}
          onSelectChannel={vi.fn()}
          defaultOpen
        />
      )
      expect(screen.queryByText('TSN')).not.toBeInTheDocument()

      fireEvent.click(screen.getByText('Sports'))
      expect(screen.getByText('TSN')).toBeInTheDocument()
    })
  })

  describe('Channel selection', () => {
    it('should call onSelectChannel when admin clicks a channel', () => {
      const onSelectChannel = vi.fn()
      render(
        <CollapsibleChannelGroup
          group={mockGroup}
          currentChannelId={null}
          canSelect={true}
          onSelectChannel={onSelectChannel}
          forceOpen={true}
        />
      )

      fireEvent.click(screen.getByText('TSN'))

      expect(onSelectChannel).toHaveBeenCalledWith(mockGroup.channels[0])
    })

    it('should not call onSelectChannel when viewer clicks a channel', () => {
      const onSelectChannel = vi.fn()
      render(
        <CollapsibleChannelGroup
          group={mockGroup}
          currentChannelId={null}
          canSelect={false}
          onSelectChannel={onSelectChannel}
          forceOpen={true}
        />
      )

      fireEvent.click(screen.getByText('TSN'))

      expect(onSelectChannel).not.toHaveBeenCalled()
    })

    it('should show "Now Playing" for selected channel', () => {
      render(
        <CollapsibleChannelGroup
          group={mockGroup}
          currentChannelId="1"
          canSelect={true}
          onSelectChannel={vi.fn()}
          forceOpen={true}
        />
      )

      expect(screen.getByText('Now Playing')).toBeInTheDocument()
    })

    it('should highlight selected channel', () => {
      render(
        <CollapsibleChannelGroup
          group={mockGroup}
          currentChannelId="1"
          canSelect={true}
          onSelectChannel={vi.fn()}
          forceOpen={true}
        />
      )

      const selectedChannel = screen.getByText('TSN').closest('[role="option"]')
      expect(selectedChannel?.className).toContain('border-primary')
    })
  })

  describe('Focus', () => {
    it.each([true, false])(
      'insets the keyboard outline on the header and channel rows (canSelect %s)',
      (canSelect) => {
        render(
          <CollapsibleChannelGroup
            group={mockGroup}
            currentChannelId="1"
            canSelect={canSelect}
            onSelectChannel={vi.fn()}
            forceOpen={true}
          />
        )

        const header = screen.getByText('Sports').closest('button')!
        const rows = screen.getAllByRole('option')
        for (const el of [header, ...rows]) {
          expect(el).toHaveClass('focus-visible:-outline-offset-2')
          expect(focusOverrides(el)).toEqual([])
        }
      }
    )
  })

  describe('Keyboard navigation', () => {
    it('should select channel when Enter is pressed', () => {
      const onSelectChannel = vi.fn()
      render(
        <CollapsibleChannelGroup
          group={mockGroup}
          currentChannelId={null}
          canSelect={true}
          onSelectChannel={onSelectChannel}
          forceOpen={true}
        />
      )

      const channelItem = screen.getByText('TSN').closest('[role="option"]')
      fireEvent.keyDown(channelItem!, { key: 'Enter' })

      expect(onSelectChannel).toHaveBeenCalledWith(mockGroup.channels[0])
    })

    it('should select channel when Space is pressed', () => {
      const onSelectChannel = vi.fn()
      render(
        <CollapsibleChannelGroup
          group={mockGroup}
          currentChannelId={null}
          canSelect={true}
          onSelectChannel={onSelectChannel}
          forceOpen={true}
        />
      )

      const channelItem = screen.getByText('TSN').closest('[role="option"]')
      fireEvent.keyDown(channelItem!, { key: ' ' })

      expect(onSelectChannel).toHaveBeenCalledWith(mockGroup.channels[0])
    })
  })
})
