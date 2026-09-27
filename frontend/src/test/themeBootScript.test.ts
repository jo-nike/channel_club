import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { createThemeBoot, THEME_BOOT_KEY } from '@/lib/themeBoot'
import { DEFAULT_THEME_ID, getTheme } from '@/lib/themes'

const html = readFileSync('index.html', 'utf8')
const match = /<script>([\s\S]*?)<\/script>/.exec(html)
if (!match) throw new Error('index.html has no inline theme boot script')
const [scriptTag, script] = match

/** Run the boot script against a fake document and localStorage. */
function boot(getItem: (key: string) => string | null) {
  const vars = new Map<string, string>()
  const classes = new Set<string>()
  const document = {
    documentElement: {
      style: { setProperty: (name: string, value: string) => vars.set(name, value) },
      classList: {
        add: (name: string) => classes.add(name),
        remove: (name: string) => classes.delete(name),
      },
    },
  }
  runInNewContext(script, { document, localStorage: { getItem } })
  return { vars, dark: classes.has('dark') }
}

describe('index.html theme boot script', () => {
  it('runs in the head before the Cast SDK and the app bundle', () => {
    const at = html.indexOf(scriptTag)
    expect(at).toBeGreaterThan(html.indexOf('name="viewport"'))
    expect(at).toBeLessThan(html.indexOf('cast_sender.js'))
    expect(at).toBeLessThan(html.indexOf('/src/main.tsx'))
    expect(at).toBeLessThan(html.indexOf('</head>'))
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

  it('falls back to dark with the default (Mocha) background when nothing is cached', () => {
    const result = boot(() => null)

    expect(result.dark).toBe(true)
    expect(result.vars.get('--background')).toBe('oklch(0.19 0.022 265)')
  })

  it('keeps its fallback in step with the default theme', () => {
    const fallback = boot(() => null)
    const defaultTheme = getTheme(DEFAULT_THEME_ID)

    expect(fallback.dark).toBe(defaultTheme.mode === 'dark')
    expect(fallback.vars.get('--background')).toBe(defaultTheme.colors.background)
  })

  it('falls back without throwing on corrupt JSON', () => {
    let result: ReturnType<typeof boot> | undefined
    expect(() => {
      result = boot(() => '{not json')
    }).not.toThrow()
    expect(result?.dark).toBe(true)
    expect(result?.vars.get('--background')).toBe('oklch(0.19 0.022 265)')
  })

  it('falls back on a snapshot from an unknown version', () => {
    const result = boot(() => JSON.stringify({ v: 2, dark: false, vars: { '--background': 'white' } }))

    expect(result.dark).toBe(true)
    expect(result.vars.get('--background')).toBe('oklch(0.19 0.022 265)')
  })

  it('does not throw when storage is blocked', () => {
    expect(() =>
      boot(() => {
        throw new Error('SecurityError: storage is disabled')
      })
    ).not.toThrow()
  })
})
