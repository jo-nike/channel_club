import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// jsdom does not evaluate media queries from the stylesheet, so this pins the
// global Reduce Motion block. The real check is DevTools emulating
// prefers-reduced-motion: reduce.
const css = readFileSync('src/index.css', 'utf8')

/** The body of the global `*, *::before, *::after` rule inside the reduce query. */
function reduceBlock(): string {
  const at = css.indexOf('@media (prefers-reduced-motion: reduce) {')
  if (at === -1) return ''
  const open = css.indexOf('{', css.indexOf('*::after', at))
  return css.slice(open + 1, css.indexOf('}', open))
}

describe('global reduced motion', () => {
  it('applies to every element and pseudo-element', () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\*,\s*\*::before,\s*\*::after \{/
    )
  })

  it('stops animations, transitions and CSS smooth scrolling', () => {
    const block = reduceBlock()
    expect(block).toContain('animation-duration: 0.01ms !important;')
    expect(block).toContain('animation-iteration-count: 1 !important;')
    expect(block).toContain('transition-duration: 0.01ms !important;')
    expect(block).toContain('scroll-behavior: auto !important;')
  })
})
