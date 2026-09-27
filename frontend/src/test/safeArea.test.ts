import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// jsdom can't evaluate env(safe-area-inset-*), so these pin the opt-in and the
// rules the components' class assertions rely on. The real check is an iPhone
// home-screen install, portrait and landscape.
const html = readFileSync('index.html', 'utf8')
const css = readFileSync('src/index.css', 'utf8')

/** The body of the first rule whose selector (or at-rule prelude) is exactly `selector`. */
function rule(selector: string): string | undefined {
  const at = css.indexOf(`${selector} {`)
  if (at === -1) return undefined
  const open = css.indexOf('{', at)
  return css.slice(open + 1, css.indexOf('}', open)).trim()
}

describe('iOS safe area', () => {
  it('opts into the full-screen layout and keeps the translucent status bar', () => {
    expect(html).toMatch(/<meta name="viewport" content="[^"]*viewport-fit=cover[^"]*"/)
    expect(html).toContain('<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">')
  })

  it('pads the header by its usual 0.5rem plus the status bar inset', () => {
    expect(rule('@utility pt-header-safe')).toBe('padding-top: calc(0.5rem + env(safe-area-inset-top, 0px));')
  })

  it('defines the inset-only padding utilities', () => {
    expect(rule('@utility pt-safe')).toBe('padding-top: env(safe-area-inset-top, 0px);')
    expect(rule('@utility pb-safe')).toBe('padding-bottom: env(safe-area-inset-bottom, 0px);')
  })

  it('moves only the edge-pinned player controls in from the insets, outside any layer', () => {
    expect(rule('.video-controls.bottom-4')).toBe('bottom: max(1rem, env(safe-area-inset-bottom));')
    expect(rule('.video-controls.left-4')).toBe('left: max(1rem, env(safe-area-inset-left));')
    expect(rule('.video-controls.right-4')).toBe('right: max(1rem, env(safe-area-inset-right));')
    // Unlayered (after the only @layer block closes), so the rules beat the
    // bottom-4/left-4/right-4 utilities
    expect(css.match(/@layer/g)).toHaveLength(1)
    const layerEnd = css.indexOf('\n}\n', css.indexOf('@layer base {'))
    expect(css.indexOf('.video-controls.bottom-4')).toBeGreaterThan(layerEnd)
    // A bare .video-controls rule would also move the centred tap-to-play button
    expect(css).not.toMatch(/\.video-controls\s*\{/)
  })
})
