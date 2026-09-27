import { beforeEach, describe, expect, it, vi } from 'vitest'
import { colorToCSSVar, createThemeBoot, saveThemeBoot, THEME_BOOT_KEY } from './themeBoot'
import { getTheme } from './themes'

describe('createThemeBoot', () => {
  it('resolves the Mocha snapshot: dark, with every CSS variable useTheme applies', () => {
    const mocha = getTheme('catppuccin-mocha')
    const boot = createThemeBoot(mocha)

    expect(boot.v).toBe(1)
    expect(boot.dark).toBe(true)
    expect(boot.vars['--background']).toBe('oklch(0.19 0.022 265)')
    expect(boot.vars['--foreground']).toBe(mocha.colors.foreground)
    expect(boot.vars['--live']).toBe(mocha.colors.live)
    expect(Object.keys(boot.vars).sort()).toEqual(Object.values(colorToCSSVar).sort())
  })

  it('resolves the Latte snapshot: light, with its own background', () => {
    const latte = getTheme('catppuccin-latte')
    const boot = createThemeBoot(latte)

    expect(boot.dark).toBe(false)
    expect(boot.vars['--background']).toBe(latte.colors.background)
    expect(boot.vars['--primary']).toBe(latte.colors.primary)
    expect(Object.keys(boot.vars)).toHaveLength(Object.keys(colorToCSSVar).length)
  })
})

describe('saveThemeBoot', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('stores the snapshot as JSON under the key index.html reads', () => {
    const boot = createThemeBoot(getTheme('catppuccin-latte'))

    saveThemeBoot(boot)

    expect(JSON.parse(localStorage.getItem(THEME_BOOT_KEY)!)).toEqual(boot)
  })

  it('does not throw when storage is unavailable', () => {
    vi.mocked(localStorage.setItem).mockImplementationOnce(() => {
      throw new DOMException('QuotaExceededError')
    })

    expect(() => saveThemeBoot(createThemeBoot(getTheme('catppuccin-mocha')))).not.toThrow()
  })
})
