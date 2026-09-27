import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// jsdom can't evaluate :focus-visible, so these pin the global rule and the
// over-video utility. The real check is a browser pass: Tab through the
// header, sidebar, guide, a dialog and the player in a dark and a light
// theme, and confirm a mouse click leaves no ring.
const css = readFileSync('src/index.css', 'utf8')

/** The body of the first rule whose selector (or at-rule prelude) is exactly `selector`, from `from`. */
function rule(selector: string, from = 0): string | undefined {
  const at = css.indexOf(`${selector} {`, from)
  if (at === -1) return undefined
  const open = css.indexOf('{', at)
  return css.slice(open + 1, css.indexOf('}', open)).trim()
}

describe('focus outline', () => {
  it('draws one solid ring-colour outline for keyboard focus, in the base layer', () => {
    const base = css.indexOf('@layer base {')
    expect(base).toBeGreaterThan(-1)
    expect(rule('  :focus-visible', base)).toBe('outline: 2px solid var(--ring);\n    outline-offset: 2px;')
  })

  it('no longer tints every element with a half-strength ring outline', () => {
    expect(css).not.toContain('outline-ring/50')
  })

  it('gives controls over video a white outline on a dark band', () => {
    const utility = css.indexOf('@utility focus-ring-media {')
    expect(utility).toBeGreaterThan(-1)
    expect(rule('  &:focus-visible', utility)).toBe(
      'outline: 2px solid white;\n    outline-offset: 2px;\n    box-shadow: 0 0 0 4px rgb(0 0 0 / 0.6);',
    )
  })
})
