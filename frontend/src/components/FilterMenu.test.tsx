import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@/test/utils'
import { FilterMenu } from './FilterMenu'
import { useFilterStore, FILTER_REGISTRY } from '@/stores/filterStore'

// Mock useMediaQuery hook
vi.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: vi.fn(() => false), // Default to desktop
}))

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      store = {}
    }),
  }
})()

Object.defineProperty(window, 'localStorage', { value: localStorageMock })

describe('FilterMenu', () => {
  beforeEach(() => {
    // Reset store state
    useFilterStore.setState({ activeFilters: [] })
    localStorageMock.clear()
  })

  it('should render filter button', () => {
    render(<FilterMenu isVisible={true} />)
    const button = screen.getByRole('button', { name: /video filters/i })
    expect(button).toBeInTheDocument()
  })

  it('should have tabIndex -1 when not visible', () => {
    render(<FilterMenu isVisible={false} />)
    const button = screen.getByRole('button', { name: /video filters/i })
    expect(button).toHaveAttribute('tabIndex', '-1')
  })

  it('should have tabIndex 0 when visible', () => {
    render(<FilterMenu isVisible={true} />)
    const button = screen.getByRole('button', { name: /video filters/i })
    expect(button).toHaveAttribute('tabIndex', '0')
  })

  it('should show active indicator when filters are active', () => {
    useFilterStore.setState({ activeFilters: ['retro-tv'] })
    const { container } = render(<FilterMenu isVisible={true} />)

    // Button should have primary text color indicating active state
    const button = container.querySelector('.text-primary')
    expect(button).toBeInTheDocument()
  })

  it('should open popover on click (desktop)', async () => {
    render(<FilterMenu isVisible={true} />)
    const button = screen.getByRole('button', { name: /video filters/i })

    fireEvent.click(button)

    // Popover content should appear
    expect(await screen.findByText('Video Filters')).toBeInTheDocument()
  })

  it('should list all filters from registry', async () => {
    render(<FilterMenu isVisible={true} />)
    const button = screen.getByRole('button', { name: /video filters/i })

    fireEvent.click(button)

    // Check all filters are listed
    for (const filter of FILTER_REGISTRY) {
      expect(await screen.findByText(filter.name)).toBeInTheDocument()
    }
  })

  it('should show Retro TV as first filter', async () => {
    render(<FilterMenu isVisible={true} />)
    const button = screen.getByRole('button', { name: /video filters/i })

    fireEvent.click(button)

    const retroTvText = await screen.findByText('Retro TV')
    expect(retroTvText).toBeInTheDocument()
  })

  it('should toggle filter when clicked', async () => {
    render(<FilterMenu isVisible={true} />)
    const button = screen.getByRole('button', { name: /video filters/i })

    fireEvent.click(button)

    // Find and click the Retro TV filter toggle
    const filterToggle = await screen.findByRole('button', { name: /retro tv/i })
    fireEvent.click(filterToggle)

    // Check store was updated
    expect(useFilterStore.getState().activeFilters).toContain('retro-tv')
  })

  it('left-aligns each filter row so wrapped descriptions do not centre', async () => {
    render(<FilterMenu isVisible={true} />)
    fireEvent.click(screen.getByRole('button', { name: /video filters/i }))

    for (const filter of FILTER_REGISTRY) {
      const row = await screen.findByRole('button', { name: new RegExp(filter.name, 'i') })
      expect(row).toHaveClass('text-left')
    }
  })

  it('opens the popover from the start of the trigger, not centred over the picture', async () => {
    render(<FilterMenu isVisible={true} />)
    fireEvent.click(screen.getByRole('button', { name: /video filters/i }))

    const heading = await screen.findByText('Video Filters')
    const content = heading.closest('[data-slot="popover-content"]')
    expect(content).toHaveAttribute('data-align', 'start')
  })

  it('should have aria-haspopup on trigger button', () => {
    render(<FilterMenu isVisible={true} />)
    const button = screen.getByRole('button', { name: /video filters/i })
    expect(button).toHaveAttribute('aria-haspopup', 'dialog')
  })
})
