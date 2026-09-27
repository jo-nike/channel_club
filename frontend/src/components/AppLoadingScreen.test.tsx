import { describe, it, expect } from 'vitest'
import { render, screen } from '@/test/utils'
import { AppLoadingScreen } from './AppLoadingScreen'

describe('AppLoadingScreen', () => {
  it('renders app title as the heading', () => {
    render(<AppLoadingScreen />)
    expect(screen.getByRole('heading', { level: 1, name: 'Channel Club' })).toBeInTheDocument()
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

  it('shows the wordmark at its large size in place of the old emoji logo', () => {
    render(<AppLoadingScreen />)
    const wordmark = screen.getByRole('img', { name: 'Channel Club' })
    expect(wordmark).toHaveAttribute('data-size', 'lg')
    expect(wordmark.querySelector('[data-slot="wordmark-dot"]')).not.toBeNull()
    expect(screen.queryByText('📺')).not.toBeInTheDocument()
  })

  it('shows the tagline', () => {
    render(<AppLoadingScreen />)
    expect(screen.getByText('Good TV. Better company.')).toBeInTheDocument()
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
