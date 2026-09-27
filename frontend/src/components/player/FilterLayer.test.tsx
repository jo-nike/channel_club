import { describe, it, expect, beforeEach } from 'vitest'
import { render, act } from '@/test/utils'
import { FilterLayer } from './FilterLayer'
import { useFilterStore } from '@/stores/filterStore'

const FILTER_CLASSES = [
  '.retro-tv-filter',
  '.film-grain-filter',
  '.noir-filter',
  '.grindhouse-filter',
  '.sports-hd-filter',
]

const rendered = (container: HTMLElement) =>
  FILTER_CLASSES.filter((selector) => container.querySelector(selector) !== null)

describe('FilterLayer', () => {
  beforeEach(() => {
    useFilterStore.setState({ activeFilters: [] })
  })

  it('renders nothing while no filter is active', () => {
    const { container } = render(<FilterLayer />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders only the active filters', () => {
    useFilterStore.setState({ activeFilters: ['noir', 'sports-hd'] })
    const { container } = render(<FilterLayer />)
    expect(rendered(container)).toEqual(['.noir-filter', '.sports-hd-filter'])
  })

  it('renders every filter once when all are active', () => {
    useFilterStore.setState({
      activeFilters: ['retro-tv', 'film-grain', 'noir', 'grindhouse', 'sports-hd'],
    })
    const { container } = render(<FilterLayer />)
    for (const selector of FILTER_CLASSES) {
      expect(container.querySelectorAll(selector)).toHaveLength(1)
    }
  })

  it('follows the filter store as filters are toggled', () => {
    const { container } = render(<FilterLayer />)

    act(() => useFilterStore.getState().toggleFilter('film-grain'))
    expect(rendered(container)).toEqual(['.film-grain-filter'])

    act(() => useFilterStore.getState().toggleFilter('film-grain'))
    expect(rendered(container)).toEqual([])
  })
})
