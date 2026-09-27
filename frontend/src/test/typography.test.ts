import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { render, screen } from '@testing-library/react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'

// jsdom doesn't run Tailwind or load webfonts, so these pin the wiring: the
// imported @font-face families, the theme tokens that name them and the base
// rule for headings. The real check is a browser pass (Chrome and Safari):
// UI text in Figtree, headings and channel numbers in Big Shoulders Display.
const css = readFileSync('src/index.css', 'utf8')
const main = readFileSync('src/main.tsx', 'utf8')

/** The body of the first rule whose selector (or at-rule prelude) is exactly `selector`, from `from`. */
function rule(selector: string, from = 0): string | undefined {
  const at = css.indexOf(`${selector} {`, from)
  if (at === -1) return undefined
  const open = css.indexOf('{', at)
  return css.slice(open + 1, css.indexOf('}', open)).trim()
}

/** The font-family names declared by a Fontsource package's entry stylesheet. */
function fontFaceFamilies(pkg: string): Set<string> {
  const source = readFileSync(`node_modules/${pkg}/index.css`, 'utf8')
  return new Set([...source.matchAll(/font-family: '([^']+)'/g)].map((m) => m[1]))
}

describe('brand fonts', () => {
  it('self-hosts both Fontsource variable fonts from the app entry', () => {
    expect(main).toContain("import '@fontsource-variable/figtree'")
    expect(main).toContain("import '@fontsource-variable/big-shoulders-display'")
    // Upright only: the few italic lines get a synthesized slant, and the
    // italic files stay out of the precache
    expect(main).not.toContain('wght-italic')
  })

  it('makes Figtree the default UI face, with the platform UI face as fallback', () => {
    expect(fontFaceFamilies('@fontsource-variable/figtree')).toEqual(new Set(['Figtree Variable']))
    expect(rule('@theme')).toContain(
      '--font-sans: "Figtree Variable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;',
    )
  })

  it('defines the display face as Big Shoulders Display, falling back to condensed faces', () => {
    expect(fontFaceFamilies('@fontsource-variable/big-shoulders-display')).toEqual(
      new Set(['Big Shoulders Display Variable']),
    )
    expect(rule('@theme')).toContain(
      '--font-display: "Big Shoulders Display Variable", "Arial Narrow", "Roboto Condensed", Impact, sans-serif;',
    )
  })

  it('sets headings and dialog titles in the display face at a display weight', () => {
    const base = css.indexOf('@layer base {')
    expect(base).toBeGreaterThan(-1)
    expect(rule('  h1,\n  h2,\n  h3,\n  [data-slot="dialog-title"]', base)).toBe(
      'font-family: var(--font-display);\n    font-weight: 700;',
    )
  })

  it('marks dialog titles with the slot the heading rule targets', () => {
    render(createElement(Dialog, { open: true },
      createElement(DialogContent, null,
        createElement(DialogTitle, null, 'Title'),
        createElement(DialogDescription, null, 'Body'),
      ),
    ))
    expect(screen.getByRole('heading', { name: 'Title' })).toHaveAttribute('data-slot', 'dialog-title')
  })
})

// Nothing renders below 12px except caps badges, which may use 11px (bold
// uppercase reads larger). 10px and 9px text failed at arm's length on a
// phone and at couch distance (H-08), so arbitrary sizes under 11px fail here.
const MIN_PX = 11

/** Arbitrary font sizes (text-[10px], text-[0.625rem], font-size: 9px) below MIN_PX in `source`. */
function tooSmall(source: string): string[] {
  const sizes = [
    ...source.matchAll(/text-\[(\d*\.?\d+)(px|rem)\]/g),
    ...source.matchAll(/font-size:\s*(\d*\.?\d+)(px|rem)/g),
  ]
  return sizes
    .filter(([, value, unit]) => Number(value) * (unit === 'rem' ? 16 : 1) < MIN_PX)
    .map(([match]) => match)
}

const sources = import.meta.glob<string>(['/src/**/*.{ts,tsx}', '!/src/**/*.test.{ts,tsx}', '!/src/test/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

describe('minimum text size', () => {
  const checked = Object.entries(sources)

  it('scans the app sources', () => {
    expect(checked.length).toBeGreaterThan(50)
    expect(checked.map(([path]) => path)).toEqual(
      expect.arrayContaining([
        '/src/components/HeaderAction.tsx',
        '/src/components/NHLScoresOverlay.tsx',
        '/src/components/admin/NHLGamesTab.tsx',
        '/src/components/tv/TVChannelSidebar.tsx',
        '/src/components/tv/MobileChannelList.tsx',
      ]),
    )
  })

  it('catches the sizes it guards against', () => {
    expect(tooSmall('text-[10px] text-[9px] text-[0.625rem] font-size: 10px')).toEqual([
      'text-[10px]',
      'text-[9px]',
      'text-[0.625rem]',
      'font-size: 10px',
    ])
    expect(tooSmall('text-xs text-[11px] text-[12px] font-size: 16px')).toEqual([])
  })

  it('index.css sets no font size under 11px', () => {
    expect(tooSmall(css)).toEqual([])
  })

  it.each(checked)('%s uses no text under 11px', (_path, source) => {
    expect(tooSmall(source)).toEqual([])
  })
})
