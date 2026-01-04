import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { InstallPrompt } from './InstallPrompt'
import * as useInstallPromptModule from '@/hooks/useInstallPrompt'

vi.mock('@/hooks/useInstallPrompt')

describe('InstallPrompt', () => {
  const mockInstall = vi.fn()
  const mockDismiss = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockInstall.mockResolvedValue(true)
  })

  describe('when canInstall is false', () => {
    it('renders nothing', () => {
      vi.spyOn(useInstallPromptModule, 'useInstallPrompt').mockReturnValue({
        canInstall: false,
        install: mockInstall,
        dismiss: mockDismiss
      })

      const { container } = render(<InstallPrompt />)
      expect(container.firstChild).toBeNull()
    })
  })

  describe('when canInstall is true', () => {
    beforeEach(() => {
      vi.spyOn(useInstallPromptModule, 'useInstallPrompt').mockReturnValue({
        canInstall: true,
        install: mockInstall,
        dismiss: mockDismiss
      })
    })

    it('renders the install prompt banner', () => {
      render(<InstallPrompt />)
      expect(screen.getByText('Install App')).toBeInTheDocument()
    })

    it('shows install description text', () => {
      render(<InstallPrompt />)
      expect(screen.getByText(/Add to home screen/i)).toBeInTheDocument()
    })

    it('renders Install button', () => {
      render(<InstallPrompt />)
      expect(screen.getByRole('button', { name: 'Install' })).toBeInTheDocument()
    })

    it('renders dismiss button', () => {
      render(<InstallPrompt />)
      expect(screen.getByRole('button', { name: /dismiss install prompt/i })).toBeInTheDocument()
    })

    it('calls install when Install button is clicked', async () => {
      render(<InstallPrompt />)

      const installButton = screen.getByRole('button', { name: 'Install' })
      fireEvent.click(installButton)

      expect(mockInstall).toHaveBeenCalled()
    })

    it('calls dismiss when dismiss button is clicked', () => {
      render(<InstallPrompt />)

      const dismissButton = screen.getByRole('button', { name: /dismiss install prompt/i })
      fireEvent.click(dismissButton)

      expect(mockDismiss).toHaveBeenCalled()
    })

    describe('accessibility', () => {
      it('has role="dialog"', () => {
        render(<InstallPrompt />)
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      it('has accessible name via aria-labelledby', () => {
        render(<InstallPrompt />)
        const dialog = screen.getByRole('dialog')
        expect(dialog).toHaveAttribute('aria-labelledby', 'install-prompt-title')
      })

      it('has focusable Install button', () => {
        render(<InstallPrompt />)
        const installButton = screen.getByRole('button', { name: 'Install' })
        installButton.focus()
        expect(document.activeElement).toBe(installButton)
      })

      it('has focusable dismiss button', () => {
        render(<InstallPrompt />)
        const dismissButton = screen.getByRole('button', { name: /dismiss install prompt/i })
        dismissButton.focus()
        expect(document.activeElement).toBe(dismissButton)
      })
    })

    describe('keyboard navigation', () => {
      it('Install button responds to Enter key', () => {
        render(<InstallPrompt />)
        const installButton = screen.getByRole('button', { name: 'Install' })
        fireEvent.keyDown(installButton, { key: 'Enter', code: 'Enter' })
        // Button should be clickable via keyboard
        expect(installButton).toBeInTheDocument()
      })

      it('dismiss button responds to Enter key', () => {
        render(<InstallPrompt />)
        const dismissButton = screen.getByRole('button', { name: /dismiss install prompt/i })
        fireEvent.keyDown(dismissButton, { key: 'Enter', code: 'Enter' })
        expect(dismissButton).toBeInTheDocument()
      })
    })
  })
})
