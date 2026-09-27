import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from './tabs'

function renderTabs(onValueChange?: (value: string) => void) {
  return render(
    <Tabs defaultValue="channels" onValueChange={onValueChange}>
      <TabsList aria-label="Panels">
        <TabsTrigger value="channels">Channels</TabsTrigger>
        <TabsTrigger value="chat">Chat</TabsTrigger>
      </TabsList>
      <TabsContent value="channels">Channel list</TabsContent>
      <TabsContent value="chat">Chat messages</TabsContent>
    </Tabs>
  )
}

describe('Tabs', () => {
  it('shows only the selected panel, labelled by its tab', () => {
    renderTabs()

    const channels = screen.getByRole('tab', { name: 'Channels' })
    expect(screen.getByRole('tablist', { name: 'Panels' })).toBeInTheDocument()
    expect(channels).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Chat' })).toHaveAttribute(
      'aria-selected',
      'false'
    )
    const panel = screen.getByRole('tabpanel')
    expect(panel).toHaveTextContent('Channel list')
    expect(panel).toHaveAttribute('aria-labelledby', channels.id)
    expect(screen.queryByText('Chat messages')).not.toBeInTheDocument()
  })

  it('switches panels when a tab is pressed', () => {
    const onValueChange = vi.fn()
    renderTabs(onValueChange)

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Chat' }))

    expect(onValueChange).toHaveBeenCalledWith('chat')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Chat messages')
  })

  it('moves between tabs with the arrow keys and activates on focus', async () => {
    renderTabs()
    const channels = screen.getByRole('tab', { name: 'Channels' })
    const chat = screen.getByRole('tab', { name: 'Chat' })
    act(() => channels.focus())

    fireEvent.keyDown(channels, { key: 'ArrowRight' })

    await waitFor(() => expect(chat).toHaveFocus())
    expect(chat).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Chat messages')
    // Only the active tab is in the page tab order (roving tabindex).
    expect(chat).toHaveAttribute('tabindex', '0')
    expect(channels).toHaveAttribute('tabindex', '-1')
  })

  it('uses focus-visible rings only, never :focus styles', () => {
    renderTabs()

    for (const el of [
      screen.getByRole('tab', { name: 'Channels' }),
      screen.getByRole('tabpanel'),
    ]) {
      expect(el.className).toContain('focus-visible:ring-[3px]')
      expect(el.className).not.toMatch(/(^|\s)focus:/)
    }
  })
})
