import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@/test/utils'
import { useInstallPrompt } from './useInstallPrompt'
import { initInstallStore, useInstallStore, type BeforeInstallPromptEvent } from '@/stores/installStore'

function createPromptEvent(): BeforeInstallPromptEvent {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as BeforeInstallPromptEvent
  event.prompt = vi.fn().mockResolvedValue(undefined)
  event.userChoice = Promise.resolve({ outcome: 'accepted' })
  return event
}

describe('useInstallPrompt', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    // Past the engagement gate: this is the third session
    localStorage.setItem('pwa-sessions', '2')
    initInstallStore()
  })

  afterEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('starts with nothing to install or promote', () => {
    const { result } = renderHook(() => useInstallPrompt())
    expect(result.current.canInstall).toBe(false)
    expect(result.current.shouldPromote).toBe(false)
  })

  it('reports an offer the browser made before the hook mounted', () => {
    act(() => {
      window.dispatchEvent(createPromptEvent())
    })

    const { result } = renderHook(() => useInstallPrompt())

    expect(result.current.canInstall).toBe(true)
    expect(result.current.shouldPromote).toBe(true)
  })

  it('follows the store when the banner is dismissed', () => {
    const { result } = renderHook(() => useInstallPrompt())
    act(() => {
      window.dispatchEvent(createPromptEvent())
    })
    expect(result.current.shouldPromote).toBe(true)

    act(() => {
      result.current.dismiss()
    })

    expect(result.current.shouldPromote).toBe(false)
    expect(result.current.canInstall).toBe(true)
  })

  it("hands out the store's install and dismiss actions", () => {
    const { result } = renderHook(() => useInstallPrompt())
    expect(result.current.install).toBe(useInstallStore.getState().install)
    expect(result.current.dismiss).toBe(useInstallStore.getState().dismiss)
  })
})
