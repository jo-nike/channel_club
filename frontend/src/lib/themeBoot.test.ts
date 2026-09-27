import { beforeEach, describe, expect, it, vi } from 'vitest'
import { colorToCSSVar, createThemeBoot, saveThemeBoot, THEME_BOOT_KEY } from './themeBoot'
import { getTheme } from './themes'
import { toHex } from './color'

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

  it('carries the background as hex for the theme-color meta', () => {
    const latte = getTheme('catppuccin-latte')

    expect(createThemeBoot(latte).themeColor).toBe(toHex(latte.colors.background))
    expect(createThemeBoot(getTheme('catppuccin-mocha')).themeColor).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('createThemeBoot while following the system', () => {
  it('stores both palettes alongside the one on screen', () => {
    const dracula = getTheme('dracula')
    const latte = getTheme('catppuccin-latte')

    const boot = createThemeBoot(latte, { dark: dracula, light: latte })

    // The top level is still the theme on screen, for older boot scripts
    expect(boot.dark).toBe(false)
    expect(boot.vars['--background']).toBe(latte.colors.background)
    expect(boot.system?.dark).toEqual({
      dark: true,
      vars: createThemeBoot(dracula).vars,
      themeColor: toHex(dracula.colors.background),
    })
    expect(boot.system?.light).toEqual({
      dark: false,
      vars: createThemeBoot(latte).vars,
      themeColor: toHex(latte.colors.background),
    })
  })

  it('leaves the pair out when not following the system', () => {
    expect(createThemeBoot(getTheme('dracula'))).not.toHaveProperty('system')
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
