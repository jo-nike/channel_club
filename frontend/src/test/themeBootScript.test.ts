import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { createThemeBoot, THEME_BOOT_KEY, type ThemeBoot } from '@/lib/themeBoot'
import { DEFAULT_THEME_ID, getTheme } from '@/lib/themes'
import { toHex } from '@/lib/color'

const html = readFileSync('index.html', 'utf8')
const match = /<script>([\s\S]*?)<\/script>/.exec(html)
if (!match) throw new Error('index.html has no inline theme boot script')
const [scriptTag, script] = match
const metaMatch = /<meta name="theme-color" content="([^"]*)">/.exec(html)
if (!metaMatch) throw new Error('index.html has no static theme-color meta')
const [metaTag, staticThemeColor] = metaMatch

/** Club Night's background, written out so a change to it shows up here */
const CLUB_NIGHT_BACKGROUND = 'oklch(0.17 0.02 275)'

/** Minimal stand-in for a <meta> element */
class FakeMeta {
  attributes = new Map<string, string>()
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value)
  }
}

/**
 * Run the boot script against a fake document and localStorage. The head
 * holds the static theme-color meta from index.html unless `withMeta` is false.
 */
function boot(getItem: (key: string) => string | null, { withMeta = true } = {}) {
  const vars = new Map<string, string>()
  const classes = new Set<string>()
  const head: FakeMeta[] = []
  if (withMeta) {
    const meta = new FakeMeta()
    meta.setAttribute('name', 'theme-color')
    meta.setAttribute('content', staticThemeColor)
    head.push(meta)
  }
  const document = {
    documentElement: {
      style: { setProperty: (name: string, value: string) => vars.set(name, value) },
      classList: {
        add: (name: string) => classes.add(name),
        remove: (name: string) => classes.delete(name),
      },
    },
    head: { appendChild: (el: FakeMeta) => head.push(el) },
    createElement: () => new FakeMeta(),
    querySelector: (selector: string) =>
      selector === 'meta[name="theme-color"]'
        ? (head.find((el) => el.attributes.get('name') === 'theme-color') ?? null)
        : null,
  }
  runInNewContext(script, { document, localStorage: { getItem } })
  const metas = head.filter((el) => el.attributes.get('name') === 'theme-color')
  return {
    vars,
    dark: classes.has('dark'),
    metaCount: metas.length,
    themeColor: metas[0]?.attributes.get('content'),
  }
}

describe('index.html theme boot script', () => {
  it('runs in the head before the Cast SDK and the app bundle', () => {
    const at = html.indexOf(scriptTag)
    expect(at).toBeGreaterThan(html.indexOf('name="viewport"'))
    expect(at).toBeLessThan(html.indexOf('cast_sender.js'))
    expect(at).toBeLessThan(html.indexOf('/src/main.tsx'))
    expect(at).toBeLessThan(html.indexOf('</head>'))
  })

  it('comes after the static theme-color meta, so its value wins', () => {
    expect(html.indexOf(metaTag)).toBeLessThan(html.indexOf(scriptTag))
    expect(html.indexOf(metaTag, html.indexOf(metaTag) + 1)).toBe(-1)
  })

  it('sets the theme-color meta to the cached theme background', () => {
    const latte = createThemeBoot(getTheme('catppuccin-latte'))

    const result = boot(() => JSON.stringify(latte))

    expect(result.metaCount).toBe(1)
    expect(result.themeColor).toBe(toHex(getTheme('catppuccin-latte').colors.background))
  })

  it('creates the theme-color meta when the page has none', () => {
    const dracula = createThemeBoot(getTheme('dracula'))

    const result = boot(() => JSON.stringify(dracula), { withMeta: false })

    expect(result.metaCount).toBe(1)
    expect(result.themeColor).toBe(toHex(getTheme('dracula').colors.background))
  })

  it('leaves the static theme-color alone for a snapshot without one', () => {
    const older: Partial<ThemeBoot> = createThemeBoot(getTheme('catppuccin-latte'))
    delete older.themeColor

    const result = boot(() => JSON.stringify(older))

    expect(result.dark).toBe(false)
    expect(result.themeColor).toBe(staticThemeColor)
  })

  it('applies a cached light theme: no dark class and its background', () => {
    const latte = createThemeBoot(getTheme('catppuccin-latte'))

    const result = boot((key) => (key === THEME_BOOT_KEY ? JSON.stringify(latte) : null))

    expect(result.dark).toBe(false)
    expect(result.vars.get('--background')).toBe(getTheme('catppuccin-latte').colors.background)
    expect(Object.fromEntries(result.vars)).toEqual(latte.vars)
  })

  it('applies a cached dark theme with the dark class', () => {
    const dracula = createThemeBoot(getTheme('dracula'))

    const result = boot(() => JSON.stringify(dracula))

    expect(result.dark).toBe(true)
    expect(result.vars.get('--background')).toBe(getTheme('dracula').colors.background)
  })

  it('falls back to dark with the default (Club Night) background when nothing is cached', () => {
    const result = boot(() => null)

    expect(result.dark).toBe(true)
    expect(result.vars.get('--background')).toBe(CLUB_NIGHT_BACKGROUND)
  })

  it('keeps its fallback in step with the default theme', () => {
    const fallback = boot(() => null)
    const defaultTheme = getTheme(DEFAULT_THEME_ID)

    expect(fallback.dark).toBe(defaultTheme.mode === 'dark')
    expect(fallback.vars.get('--background')).toBe(defaultTheme.colors.background)
    expect(fallback.themeColor).toBe(toHex(defaultTheme.colors.background))
  })

  it('falls back without throwing on corrupt JSON', () => {
    let result: ReturnType<typeof boot> | undefined
    expect(() => {
      result = boot(() => '{not json')
    }).not.toThrow()
    expect(result?.dark).toBe(true)
    expect(result?.vars.get('--background')).toBe(CLUB_NIGHT_BACKGROUND)
  })

  it('falls back on a snapshot from an unknown version', () => {
    const result = boot(() => JSON.stringify({ v: 2, dark: false, vars: { '--background': 'white' } }))

    expect(result.dark).toBe(true)
    expect(result.vars.get('--background')).toBe(CLUB_NIGHT_BACKGROUND)
  })

  it('does not throw when storage is blocked', () => {
    expect(() =>
      boot(() => {
        throw new Error('SecurityError: storage is disabled')
      })
    ).not.toThrow()
  })
})
