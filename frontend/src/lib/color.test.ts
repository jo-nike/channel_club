import { describe, it, expect } from 'vitest'
import { contrast, formatOklch, luminance, mix, parseOklch, toHex, toLinearSrgb } from './color'

describe('parseOklch', () => {
  it('parses plain L C H', () => {
    expect(parseOklch('oklch(0.85 0.14 250)')).toEqual({ l: 0.85, c: 0.14, h: 250, alpha: 1 })
  })

  it('parses a percentage lightness and alpha', () => {
    expect(parseOklch('oklch(50% 0.1 30 / 10%)')).toEqual({ l: 0.5, c: 0.1, h: 30, alpha: 0.1 })
  })

  it('parses a numeric alpha', () => {
    expect(parseOklch('oklch(1 0 0 / 0.15)').alpha).toBe(0.15)
  })

  it('throws on non-oklch input', () => {
    expect(() => parseOklch('#ffffff')).toThrow(/oklch/)
    expect(() => parseOklch('0.5 0.1 30')).toThrow(/oklch/)
  })
})

describe('toLinearSrgb', () => {
  it('maps white and black to the sRGB extremes', () => {
    toLinearSrgb('oklch(1 0 0)').forEach((v) => expect(v).toBeCloseTo(1, 4))
    expect(toLinearSrgb('oklch(0 0 0)')).toEqual([0, 0, 0])
  })

  it('clamps out-of-gamut channels to [0, 1]', () => {
    toLinearSrgb('oklch(0.7 0.4 340)').forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    })
  })
})

describe('toHex', () => {
  it('converts white', () => {
    expect(toHex('oklch(1 0 0)')).toBe('#ffffff')
  })

  it('converts black', () => {
    expect(toHex('oklch(0 0 0)')).toBe('#000000')
  })

  it('converts the Catppuccin Mocha background', () => {
    expect(toHex('oklch(0.19 0.022 265)')).toBe('#0f141e')
  })
})

describe('luminance and contrast', () => {
  it('gives white a luminance of 1 and black 0', () => {
    expect(luminance('oklch(1 0 0)')).toBeCloseTo(1, 4)
    expect(luminance('oklch(0 0 0)')).toBe(0)
  })

  it('rates white on black at 21:1 in either order', () => {
    expect(contrast('oklch(1 0 0)', 'oklch(0 0 0)')).toBeCloseTo(21, 2)
    expect(contrast('oklch(0 0 0)', 'oklch(1 0 0)')).toBeCloseTo(21, 2)
  })

  it('rates a colour against itself at 1:1', () => {
    expect(contrast('oklch(0.5 0.1 200)', 'oklch(0.5 0.1 200)')).toBe(1)
  })

  it('accepts parsed values as well as strings', () => {
    expect(contrast(parseOklch('oklch(1 0 0)'), 'oklch(0 0 0)')).toBeCloseTo(21, 2)
  })
})

describe('mix', () => {
  it('returns the first colour at 0 and the second at 1', () => {
    const a = 'oklch(0.3 0.02 265)'
    const b = 'oklch(0.85 0.14 250)'
    expect(toHex(mix(a, b, 0))).toBe(toHex(a))
    expect(toHex(mix(a, b, 1))).toBe(toHex(b))
  })

  it('interpolates lightness linearly', () => {
    expect(mix('oklch(0 0 0)', 'oklch(1 0 0)', 0.25).l).toBeCloseTo(0.25, 6)
  })

  it('treats an achromatic mix as hue 0', () => {
    const grey = mix('oklch(0.2 0 0)', 'oklch(0.8 0 0)', 0.5)
    expect(grey.c).toBeCloseTo(0, 6)
    expect(grey.h).toBe(0)
  })

  it('keeps the hue of a tint mixed into a neutral', () => {
    const tint = mix('oklch(0.98 0 0)', 'oklch(0.55 0.2 250)', 0.12)
    expect(tint.h).toBeCloseTo(250, 4)
    expect(tint.c).toBeCloseTo(0.024, 4)
  })
})

describe('formatOklch', () => {
  it('rounds to four decimals', () => {
    expect(formatOklch({ l: 0.123456, c: 0.0200001, h: 249.99999, alpha: 1 })).toBe(
      'oklch(0.1235 0.02 250)'
    )
  })

  it('includes alpha only when translucent', () => {
    expect(formatOklch({ l: 1, c: 0, h: 0, alpha: 0.1 })).toBe('oklch(1 0 0 / 0.1)')
  })

  it('round-trips through parseOklch', () => {
    const value = 'oklch(0.72 0.14 190)'
    expect(formatOklch(parseOklch(value))).toBe(value)
  })
})
