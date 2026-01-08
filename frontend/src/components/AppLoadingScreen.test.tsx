import { describe, it, expect } from 'vitest'
import { render, screen } from '@/test/utils'
import { AppLoadingScreen } from './AppLoadingScreen'

describe('AppLoadingScreen', () => {
  it('renders app title', () => {
    render(<AppLoadingScreen />)
    expect(screen.getByText('IPTV Viewer')).toBeInTheDocument()
  })

  it('renders loading spinner', () => {
    const { container } = render(<AppLoadingScreen />)
    const spinner = container.querySelector('.animate-spin')
    expect(spinner).toBeInTheDocument()
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
})
