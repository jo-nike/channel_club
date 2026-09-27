import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// jsdom does not apply scrollbar styles, so this pins the global rule. The
// real check is a dialog or the chat list in a dark theme.
const css = readFileSync('src/index.css', 'utf8')
const THEMED = 'scrollbar-color: color-mix(in oklch, var(--muted-foreground) 40%, transparent) transparent;'

/** The body of the first `selector {` rule after `from`. */
function ruleBody(selector: string, from = 0): string {
  const open = css.indexOf(`${selector} {`, from)
  if (open === -1) return ''
  const start = css.indexOf('{', open)
  return css.slice(start + 1, css.indexOf('}', start))
}

describe('themed scrollbars', () => {
  it('colours every scroll container from the root, in the base layer', () => {
    const base = css.indexOf('@layer base {')
    expect(base).toBeGreaterThan(-1)
    expect(ruleBody('  html', base)).toContain(THEMED)
  })

  it('declares the colour once, not again on the guide', () => {
    expect(css.split('scrollbar-color:')).toHaveLength(2)
    expect(ruleBody('.epg-scroll')).toContain('scrollbar-width: thin;')
  })
})
