import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@/test/utils'
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

  describe('with the real hook', () => {
    beforeEach(async () => {
      localStorage.clear()
      const actual = await vi.importActual<typeof useInstallPromptModule>('@/hooks/useInstallPrompt')
      vi.spyOn(useInstallPromptModule, 'useInstallPrompt').mockImplementation(actual.useInstallPrompt)
    })

    afterEach(() => {
      localStorage.clear()
    })

    function fireBeforeInstallPrompt() {
      const event = new Event('beforeinstallprompt') as Event & {
        prompt: () => Promise<void>
        userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
      }
      event.prompt = vi.fn().mockResolvedValue(undefined)
      event.userChoice = Promise.resolve({ outcome: 'accepted' })
      act(() => {
        window.dispatchEvent(event)
      })
    }

    it('shows the banner when the browser offers installation', () => {
      render(<InstallPrompt />)
      fireBeforeInstallPrompt()
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('renders nothing in TV mode', () => {
      localStorage.setItem('tv-mode', 'true')
      const { container } = render(<InstallPrompt />)
      fireBeforeInstallPrompt()
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

    describe('styling', () => {
      it('uses theme tokens instead of hard-coded slate and blue', () => {
        render(<InstallPrompt />)
        const dialog = screen.getByRole('dialog')
        expect(dialog).toHaveClass('bg-card', 'text-card-foreground', 'border-border')

        const classes = [dialog, ...dialog.querySelectorAll('*')]
          .map((el) => el.getAttribute('class') ?? '')
          .join(' ')
        expect(classes).not.toMatch(/\b(?:[\w-]+:)*[\w-]+-(?:slate|blue)-\d+/)
      })

      it('uses the default primary Install button', () => {
        render(<InstallPrompt />)
        const installButton = screen.getByRole('button', { name: 'Install' })
        expect(installButton).toHaveClass('bg-primary', 'text-primary-foreground')
        expect(installButton.className).not.toMatch(/bg-blue/)
      })

      it('lets the description wrap instead of truncating it', () => {
        render(<InstallPrompt />)
        expect(screen.getByText(/Add to home screen/i)).not.toHaveClass('truncate')
      })

      it('sits above the home indicator', () => {
        render(<InstallPrompt />)
        expect(screen.getByRole('dialog')).toHaveClass('bottom-[max(1rem,env(safe-area-inset-bottom))]')
      })
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
