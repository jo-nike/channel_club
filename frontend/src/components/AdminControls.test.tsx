import { describe, it, expect } from 'vitest'
import { render, screen } from '@/test/utils'
import { AdminControls } from './AdminControls'

describe('AdminControls', () => {
  it('should render channel selection heading', () => {
    render(<AdminControls />)

    expect(screen.getByRole('heading', { name: /channel selection/i })).toBeInTheDocument()
  })

  it('should render placeholder message', () => {
    render(<AdminControls />)

    expect(screen.getByText(/channel list will be implemented/i)).toBeInTheDocument()
  })

  it('should have proper container styling for 10-foot UI', () => {
    const { container } = render(<AdminControls />)

    // Container should have padding
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).toContain('p-4')
  })
})
