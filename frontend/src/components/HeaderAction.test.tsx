import { describe, it, expect, vi } from 'vitest'
import { LayoutList } from 'lucide-react'
import { render, screen, fireEvent, act } from '@/test/utils'
import { HeaderAction } from './HeaderAction'

describe('HeaderAction', () => {
  it('is a toolbar button named by its label, and runs its action', () => {
    const onClick = vi.fn()
    render(<HeaderAction icon={<LayoutList />} label="Refresh video" onClick={onClick} />)

    const button = screen.getByRole('button', { name: 'Refresh video' })
    expect(button).toHaveAttribute('data-variant', 'toolbar')
    expect(button).toHaveAttribute('data-size', 'toolbar')
    expect(button).toHaveAttribute('type', 'button')
    // A plain action is not a toggle
    expect(button).not.toHaveAttribute('aria-pressed')

    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('reports its toggle state through aria-pressed', () => {
    const { rerender } = render(<HeaderAction icon={<LayoutList />} label="Guide" pressed />)
    expect(screen.getByRole('button', { name: 'Guide' })).toHaveAttribute('aria-pressed', 'true')

    rerender(<HeaderAction icon={<LayoutList />} label="Guide" pressed={false} />)
    expect(screen.getByRole('button', { name: 'Guide' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('draws a pressed label in the foreground colour on the primary tint', () => {
    render(<HeaderAction icon={<LayoutList />} label="Guide" visibleLabel="Guide" pressed />)
    const button = screen.getByRole('button', { name: 'Guide' })
    // Primary text on its own 15% tint misses 4.5:1 in Latte, Peachy and
    // Camouflage; the tint carries the state and the icon keeps the hue
    expect(button).toHaveClass('aria-pressed:bg-primary/15', 'aria-pressed:text-foreground', 'aria-pressed:[&_svg]:text-primary')
    expect(button).not.toHaveClass('aria-pressed:text-primary')
  })

  it('shows its label in a tooltip on keyboard focus', async () => {
    render(<HeaderAction icon={<LayoutList />} label="Open admin panel" visibleLabel="Host" />)
    expect(screen.queryByRole('tooltip')).toBeNull()

    await act(async () => {
      screen.getByRole('button', { name: 'Open admin panel' }).focus()
    })

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Open admin panel')
  })

  it('shows a given tooltip in place of the label, keeping the label as its name', async () => {
    render(<HeaderAction icon={<LayoutList />} label="Chat" tooltip="Chat (C)" />)

    const button = screen.getByRole('button', { name: 'Chat' })
    await act(async () => {
      button.focus()
    })

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Chat (C)')
    expect(button).toHaveAccessibleName('Chat')
  })

  it('shows a short visible label from lg and widens to fit it', () => {
    render(<HeaderAction icon={<LayoutList />} label="Change live channel" visibleLabel="Change live" />)

    const button = screen.getByRole('button', { name: 'Change live channel' })
    expect(screen.getByText('Change live')).toHaveClass('hidden', 'lg:inline')
    expect(button).toHaveClass('lg:w-auto', 'lg:px-3')
    // With a mouse the toolbar size is pointer-fine:md:size-9, emitted after lg:w-auto,
    // so the label also needs the pointer-fine width or it spills out of a 36px box
    expect(button).toHaveClass('pointer-fine:md:size-9', 'pointer-fine:lg:w-auto')
  })

  it('stays a square icon button without a visible label', () => {
    render(<HeaderAction icon={<LayoutList />} label="Refresh video" />)

    const button = screen.getByRole('button', { name: 'Refresh video' })
    expect(button.textContent).toBe('')
    expect(button).not.toHaveClass('lg:w-auto')
  })

  it('shows a count badge on destructive, capped at 9+, and none at zero', () => {
    const { rerender } = render(<HeaderAction icon={<LayoutList />} label="Chat" badge={3} />)
    const badge = screen.getByText('3')
    expect(badge).toHaveClass(
      'bg-destructive',
      'text-destructive-foreground',
      'dark:bg-[color-mix(in_oklab,var(--destructive)_60%,var(--background))]'
    )
    // Opaque, and ringed in the background colour so it stands off a filled button
    expect(badge.className).not.toMatch(/bg-destructive\//)
    expect(badge).toHaveClass('ring-2', 'ring-background')

    rerender(<HeaderAction icon={<LayoutList />} label="Chat" badge={12} />)
    expect(screen.getByText('9+')).toBeInTheDocument()

    rerender(<HeaderAction icon={<LayoutList />} label="Chat" badge={0} />)
    expect(screen.getByRole('button', { name: 'Chat' }).textContent).toBe('')
  })

  it('can be the filled primary action', () => {
    render(<HeaderAction icon={<LayoutList />} label="Chat" variant="default" />)
    const button = screen.getByRole('button', { name: 'Chat' })
    expect(button).toHaveClass('bg-primary', 'text-primary-foreground')
    expect(button).toHaveAttribute('data-size', 'toolbar')
  })

  it('passes other button attributes through', () => {
    render(<HeaderAction icon={<LayoutList />} label="Chat" aria-expanded={false} aria-controls="chat-panel" />)
    const button = screen.getByRole('button', { name: 'Chat' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveAttribute('aria-controls', 'chat-panel')
  })
})
