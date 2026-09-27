import { describe, it, expect } from 'vitest'
import { render, screen } from '@/test/utils'
import { AppLoadingScreen } from './AppLoadingScreen'

describe('AppLoadingScreen', () => {
  it('renders app title', () => {
    render(<AppLoadingScreen />)
    expect(screen.getByText('Channel Club')).toBeInTheDocument()
  })

  it('renders loading spinner', () => {
    const { container } = render(<AppLoadingScreen />)
    const spinner = container.querySelector('.animate-spin')
    expect(spinner).toBeInTheDocument()
  })

  it('says it is loading, since Reduce Motion freezes the spinner', () => {
    render(<AppLoadingScreen />)
    expect(screen.getByText('Loading…')).toBeVisible()
  })

  it('renders app logo emoji', () => {
    render(<AppLoadingScreen />)
    expect(screen.getByText('📺')).toBeInTheDocument()
  })

  it('is full screen height', () => {
    const { container } = render(<AppLoadingScreen />)
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).toContain('h-screen')
  })

  it('keeps its content clear of the status bar and home indicator', () => {
    const { container } = render(<AppLoadingScreen />)
    expect(container.firstChild).toHaveClass('pt-safe', 'pb-safe')
  })
})
