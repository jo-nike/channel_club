import { afterEach, describe, it, expect } from 'vitest'
import { act, render, waitFor } from '@/test/utils'
import { toast } from 'sonner'
import { Toaster } from './sonner'

describe('Toaster', () => {
  it('shows toasts top-center, clear of the safe area on desktop and phones', async () => {
    render(<Toaster />)
    act(() => { toast('Hello') })

    const toaster = await waitFor(() => {
      const element = document.querySelector<HTMLElement>('[data-sonner-toaster]')
      expect(element).not.toBeNull()
      return element!
    })
    expect(toaster).toHaveAttribute('data-y-position', 'top')
    expect(toaster).toHaveAttribute('data-x-position', 'center')
    for (const prefix of ['--offset', '--mobile-offset']) {
      expect(toaster.style.getPropertyValue(`${prefix}-top`)).toBe('calc(16px + env(safe-area-inset-top, 0px))')
    }
  })

  it('draws toasts in the app font, not Sonner\'s system font stack', async () => {
    render(<Toaster />)
    act(() => { toast('Hello') })

    const toaster = await waitFor(() => {
      const element = document.querySelector<HTMLElement>('[data-sonner-toaster]')
      expect(element).not.toBeNull()
      return element!
    })
    // jsdom resolves no fonts, so check the inline style that beats Sonner's rule
    expect(toaster.style.fontFamily).toBe('var(--font-sans)')
  })

  describe('with the player fullscreen', () => {
    const setFullscreenElement = (element: Element | null) => act(() => {
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: element })
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    const toasterElement = () => document.querySelector<HTMLElement>('[data-sonner-toaster]')

    afterEach(() => {
      setFullscreenElement(null)
      toast.dismiss()
    })

    it('shows toasts inside the fullscreen player, where they stay in view, and back on the page after', async () => {
      const shell = document.createElement('div')
      shell.setAttribute('data-player-shell', '')
      document.body.appendChild(shell)
      const { container } = render(<Toaster />)

      setFullscreenElement(shell)
      act(() => { toast('Match starts now on TSN') })
      await waitFor(() => expect(shell).toHaveTextContent('Match starts now on TSN'))
      expect(shell).toContainElement(toasterElement())

      setFullscreenElement(null)
      act(() => { toast('Live changed to CBC') })
      await waitFor(() => expect(container).toHaveTextContent('Live changed to CBC'))
      expect(shell).not.toContainElement(toasterElement())
      shell.remove()
    })

    it('stays on the page while something other than the player is fullscreen', async () => {
      const other = document.createElement('div')
      document.body.appendChild(other)
      const { container } = render(<Toaster />)

      setFullscreenElement(other)
      act(() => { toast('Hello') })
      await waitFor(() => expect(container).toHaveTextContent('Hello'))
      expect(other).toBeEmptyDOMElement()
      other.remove()
    })
  })
})
