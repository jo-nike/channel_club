import '@testing-library/jest-dom'

// Mock localStorage with actual storage functionality AND vi.fn() for mockability
const createLocalStorageMock = () => {
  let store: Record<string, string> = {}

  // Create the mock with vi.fn() but use real implementation by default
  const getItemFn = vi.fn((key: string): string | null => {
    return key in store ? store[key] : null
  })

  const setItemFn = vi.fn((key: string, value: string): void => {
    store[key] = String(value)
  })

  const removeItemFn = vi.fn((key: string): void => {
    delete store[key]
  })

  const clearFn = vi.fn((): void => {
    store = {}
  })

  return {
    getItem: getItemFn,
    setItem: setItemFn,
    removeItem: removeItemFn,
    clear: clearFn,
    get length(): number {
      return Object.keys(store).length
    },
    key: (index: number): string | null => {
      const keys = Object.keys(store)
      return keys[index] || null
    },
    // Expose store for testing purposes
    _store: store,
    // Reset both mocks and store
    _reset: () => {
      store = {}
      getItemFn.mockClear()
      setItemFn.mockClear()
      removeItemFn.mockClear()
      clearFn.mockClear()
    },
  }
}

Object.defineProperty(window, 'localStorage', {
  value: createLocalStorageMock(),
  writable: true,
})
