import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { render } from '@/test/utils'
import { AppIcon } from './AppIcon'

const favicon = readFileSync('public/favicon.svg', 'utf8')
const css = readFileSync('src/index.css', 'utf8')

function attribute(source: string, tag: string, name: string): string | undefined {
  return new RegExp(`<${tag}[^>]*\\s${name}="([^"]+)"`).exec(source)?.[1]
}

describe('AppIcon', () => {
  it("draws public/favicon.svg's tile and glyph", () => {
    const { container } = render(<AppIcon />)
    const svg = container.querySelector('svg')!
    const rect = svg.querySelector('rect')!
    const path = svg.querySelector('path')!

    expect(svg).toHaveAttribute('viewBox', attribute(favicon, 'svg', 'viewBox'))
    expect(rect).toHaveAttribute('fill', attribute(favicon, 'rect', 'fill'))
    expect(path).toHaveAttribute('fill', attribute(favicon, 'path', 'fill'))
    expect(path).toHaveAttribute('fill-rule', attribute(favicon, 'path', 'fill-rule'))
    expect(path.getAttribute('d')).toBe(attribute(favicon, 'path', 'd'))
  })

  it('is decorative', () => {
    const { container } = render(<AppIcon />)

    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('takes its size and shape from className', () => {
    const { container } = render(<AppIcon className="size-16 rounded-[15px]" />)

    expect(container.querySelector('svg')).toHaveClass('size-16', 'rounded-[15px]')
  })

  it('switches only the mark on with turnOn, never the tile', () => {
    const { container } = render(<AppIcon turnOn className="size-16" />)

    expect(container.querySelector('[data-slot="app-icon-mark"]')).toHaveClass('animate-crt-on')
    expect(container.querySelector('svg')).not.toHaveClass('animate-crt-on')
    expect(container.querySelector('rect')).not.toHaveAttribute('class')
  })

  it('stays still without turnOn', () => {
    const { container } = render(<AppIcon />)

    expect(container.querySelectorAll('[class*="animate-"]')).toHaveLength(0)
  })

  it.each([
    ['crt-on', '.animate-crt-on'],
    ['on-air-pulse', '.animate-on-air-pulse'],
  ])('index.css defines @keyframes %s and %s after the base layer', (keyframes, utility) => {
    const baseLayerEnd = css.indexOf('\n}\n', css.indexOf('@layer base {'))

    expect(css.indexOf(`@keyframes ${keyframes} {`)).toBeGreaterThan(baseLayerEnd)
    expect(css.indexOf(`${utility} {`)).toBeGreaterThan(baseLayerEnd)
    expect(css).toMatch(new RegExp(`\\${utility} \\{[^}]*animation: ${keyframes} `))
  })
})
