import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@/test/utils'
import { ThemePicker } from './ThemePicker'
import { useThemeStore } from '@/stores/themeStore'
import { DEFAULT_THEME_ID, getThemeCategories } from '@/lib/themes'

describe('ThemePicker', () => {
  beforeEach(() => {
    // Reset store to initial state
    useThemeStore.setState({ themeId: DEFAULT_THEME_ID })

    // Clean up document
    document.documentElement.classList.remove('dark')
    document.documentElement.style.cssText = ''
  })

  afterEach(() => {
    document.documentElement.classList.remove('dark')
    document.documentElement.style.cssText = ''
  })

  describe('rendering', () => {
    it('should render the theme picker button', () => {
      render(<ThemePicker />)

      const button = screen.getByRole('button', { name: /choose theme/i })
      expect(button).toBeInTheDocument()
    })

    it('should have accessible label on trigger button', () => {
      render(<ThemePicker />)

      const button = screen.getByRole('button', { name: /choose theme/i })
      expect(button).toHaveAttribute('aria-label', 'Choose theme')
    })

    it('should not show popover content initially', () => {
      render(<ThemePicker />)

      expect(screen.queryByText('Dark Themes')).not.toBeInTheDocument()
    })
  })

  describe('popover interaction', () => {
    it('should open popover when button is clicked', () => {
      render(<ThemePicker />)

      const button = screen.getByRole('button', { name: /choose theme/i })
      fireEvent.click(button)

      expect(screen.getByText('Dark Themes')).toBeInTheDocument()
      expect(screen.getByText('Light Themes')).toBeInTheDocument()
    })

    it('should display all theme categories', () => {
      render(<ThemePicker />)

      const button = screen.getByRole('button', { name: /choose theme/i })
      fireEvent.click(button)

      const categories = getThemeCategories()
      categories.forEach((category) => {
        expect(screen.getByText(category.label)).toBeInTheDocument()
      })
    })

    it('should display all themes', () => {
      render(<ThemePicker />)

      const button = screen.getByRole('button', { name: /choose theme/i })
      fireEvent.click(button)

      // Check some specific themes
      expect(screen.getByText('Catppuccin Mocha')).toBeInTheDocument()
      expect(screen.getByText('Dracula')).toBeInTheDocument()
      expect(screen.getByText('Neon Pink')).toBeInTheDocument()
      expect(screen.getByText('Zebra')).toBeInTheDocument()
      expect(screen.getByText('Catppuccin Latte')).toBeInTheDocument()
    })

    it('should close popover when theme is selected', () => {
      render(<ThemePicker />)

      // Open popover
      const button = screen.getByRole('button', { name: /choose theme/i })
      fireEvent.click(button)

      // Select a theme
      const draculaButton = screen.getByText('Dracula')
      fireEvent.click(draculaButton)

      // Popover should close
      expect(screen.queryByText('Dark Themes')).not.toBeInTheDocument()
    })
  })

  describe('theme selection', () => {
    it('should update theme store when theme is selected', () => {
      render(<ThemePicker />)

      // Open popover
      const button = screen.getByRole('button', { name: /choose theme/i })
      fireEvent.click(button)

      // Select a theme
      const draculaButton = screen.getByText('Dracula')
      fireEvent.click(draculaButton)

      // Verify store is updated
      expect(useThemeStore.getState().themeId).toBe('dracula')
    })

    it('should highlight currently selected theme', () => {
      render(<ThemePicker />)

      // Open popover
      const button = screen.getByRole('button', { name: /choose theme/i })
      fireEvent.click(button)

      // Default theme button should have aria-pressed true
      const mochaButton = screen.getByText('Catppuccin Mocha').closest('button')
      expect(mochaButton).toHaveAttribute('aria-pressed', 'true')

      // Other themes should not be pressed
      const draculaButton = screen.getByText('Dracula').closest('button')
      expect(draculaButton).toHaveAttribute('aria-pressed', 'false')
    })

    it('should update selection indicator when theme changes', () => {
      render(<ThemePicker />)

      // Open popover
      const button = screen.getByRole('button', { name: /choose theme/i })
      fireEvent.click(button)

      // Select Dracula
      fireEvent.click(screen.getByText('Dracula'))

      // Reopen popover
      fireEvent.click(button)

      // Dracula should now be selected
      const draculaButton = screen.getByText('Dracula').closest('button')
      expect(draculaButton).toHaveAttribute('aria-pressed', 'true')

      // Mocha should no longer be selected
      const mochaButton = screen.getByText('Catppuccin Mocha').closest('button')
      expect(mochaButton).toHaveAttribute('aria-pressed', 'false')
    })
  })

  describe('theme preview swatches', () => {
    it('should display color swatches for each theme', () => {
      render(<ThemePicker />)

      // Open popover
      const button = screen.getByRole('button', { name: /choose theme/i })
      fireEvent.click(button)

      // Each theme button should have 3 color swatches (background, primary, accent)
      // Find a theme button (not the trigger)
      const draculaButton = screen.getByText('Dracula').closest('button')
      expect(draculaButton).toBeInTheDocument()

      // Check that there are color swatch divs inside
      const swatches = draculaButton!.querySelectorAll('[aria-hidden="true"]')
      expect(swatches.length).toBeGreaterThanOrEqual(3)
    })
  })

  describe('light/dark theme categorization', () => {
    it('should display dark themes in Dark Themes section', () => {
      render(<ThemePicker />)

      const button = screen.getByRole('button', { name: /choose theme/i })
      fireEvent.click(button)

      // Find the Dark Themes heading
      const darkHeading = screen.getByText('Dark Themes')
      expect(darkHeading).toBeInTheDocument()

      // Verify dark themes are present
      expect(screen.getByText('Catppuccin Mocha')).toBeInTheDocument()
      expect(screen.getByText('Dracula')).toBeInTheDocument()
    })

    it('should display light themes in Light Themes section', () => {
      render(<ThemePicker />)

      const button = screen.getByRole('button', { name: /choose theme/i })
      fireEvent.click(button)

      // Find the Light Themes heading
      const lightHeading = screen.getByText('Light Themes')
      expect(lightHeading).toBeInTheDocument()

      // Verify light themes are present
      expect(screen.getByText('Catppuccin Latte')).toBeInTheDocument()
      expect(screen.getByText('Zebra')).toBeInTheDocument()
      expect(screen.getByText('Peachy')).toBeInTheDocument()
    })
  })
})
