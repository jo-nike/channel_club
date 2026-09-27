import { describe, it, expect } from 'vitest'
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
})
