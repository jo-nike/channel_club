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
    expect(screen.getByText('Signing in...')).toBeInTheDocument()
  })

  it('calls onClick when clicked', () => {
    const onClick = vi.fn()
    render(<PlexLoginButton onClick={onClick} isLoading={false} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalled()
  })

  it('is disabled when loading', () => {
    render(<PlexLoginButton onClick={vi.fn()} isLoading={true} />)
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('has Plex orange background color', () => {
    render(<PlexLoginButton onClick={vi.fn()} isLoading={false} />)
    const button = screen.getByRole('button')
    expect(button).toHaveClass('bg-[#E5A00D]')
  })

  it('leaves focus to the global outline, so a click draws no ring', () => {
    render(<PlexLoginButton onClick={vi.fn()} isLoading={false} />)
    expect(focusOverrides(screen.getByRole('button'))).toEqual([])
  })
})
