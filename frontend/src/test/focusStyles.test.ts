import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { render, screen } from '@testing-library/react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'

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

/** Classes that would hide or restyle the global outline on focus. */
function focusOverrides(el: Element): string[] {
  return Array.from(el.classList).filter(
    (c) => /^outline-(none|hidden)$/.test(c) || /^(\w+:)*focus(-visible)?:(ring|outline)/.test(c),
  )
}

describe('ui primitives rely on the global focus outline', () => {
  it('buttons, including destructive ones, add no outline or ring of their own', () => {
    render(createElement('div', null,
      createElement(Button, null, 'Save'),
      createElement(Button, { variant: 'destructive' }, 'Delete'),
    ))
    expect(focusOverrides(screen.getByRole('button', { name: 'Save' }))).toEqual([])
    expect(focusOverrides(screen.getByRole('button', { name: 'Delete' }))).toEqual([])
  })

  it('badges add no outline or ring of their own', () => {
    render(createElement(Badge, { variant: 'destructive' }, 'Live'))
    expect(focusOverrides(screen.getByText('Live'))).toEqual([])
  })

  it('inputs and textareas keep the ring-colour border alongside the outline', () => {
    render(createElement('div', null,
      createElement(Input, { 'aria-label': 'Name' }),
      createElement(Textarea, { 'aria-label': 'Message' }),
    ))
    for (const field of [screen.getByLabelText('Name'), screen.getByLabelText('Message')]) {
      expect(focusOverrides(field)).toEqual([])
      expect(field).toHaveClass('focus-visible:border-ring')
    }
  })

  it('insets the scroll area viewport outline so the rounded root does not clip it', () => {
    const { container } = render(createElement(ScrollArea, null, 'Messages'))
    const viewport = container.querySelector('[data-slot="scroll-area-viewport"]')!
    expect(focusOverrides(viewport)).toEqual([])
    expect(viewport).toHaveClass('focus-visible:-outline-offset-2')
  })

  it('the dialog close button has no click-time ring', () => {
    render(createElement(Dialog, { open: true },
      createElement(DialogContent, null,
        createElement(DialogTitle, null, 'Title'),
        createElement(DialogDescription, null, 'Body'),
      ),
    ))
    const close = screen.getByRole('button', { name: 'Close' })
    expect(focusOverrides(close)).toEqual([])
    expect(close.className).not.toMatch(/ring/)
  })
})
