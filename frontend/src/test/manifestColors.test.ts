import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { DEFAULT_THEME_ID, getTheme } from '@/lib/themes'
import { toHex } from '@/lib/color'

const config = readFileSync('vite.config.ts', 'utf8')
const html = readFileSync('index.html', 'utf8')

/** The single `key: '#rrggbb'` value in the PWA manifest options */
function manifestColor(key: string): string {
  const matches = [...config.matchAll(new RegExp(`\\b${key}: '(#[0-9a-fA-F]{6})'`, 'g'))]
  expect(matches).toHaveLength(1)
  return matches[0][1]
}

describe('PWA manifest colours', () => {
  const defaultBackground = toHex(getTheme(DEFAULT_THEME_ID).colors.background)

  it('paints the install splash in the default theme background', () => {
    expect(manifestColor('background_color')).toBe(defaultBackground)
  })

  it('colours the installed title bar like the default theme', () => {
    expect(manifestColor('theme_color')).toBe(defaultBackground)
  })

  it('matches the static theme-color meta used before a theme is saved', () => {
    const meta = /<meta name="theme-color" content="([^"]*)">/.exec(html)
    expect(meta?.[1]).toBe(manifestColor('theme_color'))
  })
})
