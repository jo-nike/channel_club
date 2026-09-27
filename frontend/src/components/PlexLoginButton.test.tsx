import { render, screen, fireEvent } from '@/test/utils'
import { describe, it, expect, vi } from 'vitest'
import { PlexLoginButton } from './PlexLoginButton'
import { focusOverrides } from '@/test/focus'

describe('PlexLoginButton', () => {
  it('renders with Plex branding', () => {
    render(<PlexLoginButton onClick={vi.fn()} isLoading={false} />)
    expect(screen.getByText('Sign in with Plex')).toBeInTheDocument()
  })

  it('shows loading state', () => {
    render(<PlexLoginButton onClick={vi.fn()} isLoading={true} />)
    expect(screen.getByText('Waiting for Plex...')).toBeInTheDocument()
  })

  it('calls onClick when clicked', () => {
    const onClick = vi.fn()
    render(<PlexLoginButton onClick={onClick} isLoading={false} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalled()
  })

  it('is disabled when loading', () => {
    render(<PlexLoginButton onClick={vi.fn()} isLoading={true} />)
    expect(screen.getByRole('button', { name: 'Waiting for Plex...' })).toBeDisabled()
  })

  it('renders a Cancel button while loading that calls onCancel', () => {
    const onCancel = vi.fn()
    render(<PlexLoginButton onClick={vi.fn()} isLoading={true} onCancel={onCancel} />)

    const cancel = screen.getByRole('button', { name: 'Cancel' })
    expect(cancel).toBeEnabled()
    fireEvent.click(cancel)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('shows no Cancel button when not loading', () => {
    render(<PlexLoginButton onClick={vi.fn()} isLoading={false} onCancel={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
  })

  it('can be disabled without showing the waiting state', () => {
    render(<PlexLoginButton onClick={vi.fn()} isLoading={false} disabled onCancel={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Sign in with Plex' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
  })

  it('has Plex orange background color', () => {
    render(<PlexLoginButton onClick={vi.fn()} isLoading={false} />)
    const button = screen.getByRole('button')
    expect(button).toHaveClass('bg-[#E5A00D]')
  })

  it('is desktop-sized by default', () => {
    render(<PlexLoginButton onClick={vi.fn()} isLoading={false} />)
    const button = screen.getByRole('button', { name: 'Sign in with Plex' })
    expect(button).toHaveClass('h-12', 'text-base')
    expect(button).not.toHaveClass('h-14')
    expect(button).not.toHaveClass('text-2xl')
  })

  it('is room-sized on a TV', () => {
    render(<PlexLoginButton onClick={vi.fn()} isLoading={false} tv />)
    const button = screen.getByRole('button', { name: 'Sign in with Plex' })
    expect(button).toHaveClass('h-14', 'text-2xl')
    expect(button).not.toHaveClass('h-12')
  })

  it('leaves focus to the global outline, so a click draws no ring', () => {
    render(<PlexLoginButton onClick={vi.fn()} isLoading={false} />)
    expect(focusOverrides(screen.getByRole('button'))).toEqual([])
  })

  it('leaves focus on the Cancel button to the global outline too', () => {
    render(<PlexLoginButton onClick={vi.fn()} isLoading={true} onCancel={vi.fn()} />)
    expect(focusOverrides(screen.getByRole('button', { name: 'Cancel' }))).toEqual([])
  })
})
