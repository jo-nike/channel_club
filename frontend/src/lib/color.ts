/**
 * OKLCH colour helpers and WCAG 2.x contrast.
 *
 * Theme tokens are OKLCH strings (e.g. "oklch(0.85 0.14 250)"). These helpers
 * let the theme generators derive colours numerically and let tests enforce
 * contrast on every generated theme.
 *
 * Conversions use Björn Ottosson's OKLab matrices. Out-of-gamut colours are
 * clamped per channel in sRGB, which is close to (but not exactly) the chroma
 * reduction browsers apply, so contrast figures for vivid colours are
 * approximate.
 */

export interface Oklch {
  l: number
  c: number
  h: number
  alpha: number
}

type Rgb = [number, number, number]

const OKLCH_PATTERN =
  /^oklch\(\s*([0-9.]+)(%?)\s+([0-9.]+)\s+([0-9.]+)(?:deg)?\s*(?:\/\s*([0-9.]+)(%?)\s*)?\)$/

/**
 * Parse an `oklch(L C H [/ alpha])` string. L and alpha accept a number or a
 * percentage. Throws on anything else, so a malformed token fails loudly.
 */
export function parseOklch(value: string): Oklch {
  const match = OKLCH_PATTERN.exec(value.trim())
  if (!match) {
    throw new Error(`Not an oklch() colour: ${value}`)
  }
  const [, l, lPercent, c, h, alpha, alphaPercent] = match
  return {
    l: lPercent ? parseFloat(l) / 100 : parseFloat(l),
    c: parseFloat(c),
    h: parseFloat(h),
    alpha: alpha === undefined ? 1 : alphaPercent ? parseFloat(alpha) / 100 : parseFloat(alpha),
  }
}

/** Format an Oklch value as a CSS string, rounded to 4 decimals. */
export function formatOklch({ l, c, h, alpha }: Oklch): string {
  const round = (n: number) => Number(n.toFixed(4))
  const base = `${round(l)} ${round(c)} ${round(h)}`
  return alpha < 1 ? `oklch(${base} / ${round(alpha)})` : `oklch(${base})`
}

function toColor(color: string | Oklch): Oklch {
  return typeof color === 'string' ? parseOklch(color) : color
}

function toOklab({ l, c, h }: Oklch): Rgb {
  const rad = (h * Math.PI) / 180
  return [l, c * Math.cos(rad), c * Math.sin(rad)]
}

/** Linear-light sRGB channels, each clamped to [0, 1]. */
export function toLinearSrgb(color: string | Oklch): Rgb {
  const [L, a, b] = toOklab(toColor(color))
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const clamp = (v: number) => Math.min(1, Math.max(0, v))
  return [
    clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

/** WCAG relative luminance (0 for black, 1 for white). Alpha is ignored. */
export function luminance(color: string | Oklch): number {
  const [r, g, b] = toLinearSrgb(color)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two opaque colours, from 1 to 21. */
export function contrast(a: string | Oklch, b: string | Oklch): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Hex string (#rrggbb) for a colour, clamped to the sRGB gamut. */
export function toHex(color: string | Oklch): string {
  const encode = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)
  return (
    '#' +
    toLinearSrgb(color)
      .map((v) => Math.round(encode(v) * 255).toString(16).padStart(2, '0'))
      .join('')
  )
}

/**
 * Mix `amount` (0-1) of `b` into `a` in OKLab, like
 * `color-mix(in oklab, b amount, a)`. Returns an opaque Oklch value.
 */
export function mix(a: string | Oklch, b: string | Oklch, amount: number): Oklch {
  const [aL, aA, aB] = toOklab(toColor(a))
  const [bL, bA, bB] = toOklab(toColor(b))
  const L = aL + (bL - aL) * amount
  const A = aA + (bA - aA) * amount
  const B = aB + (bB - aB) * amount
  const c = Math.hypot(A, B)
  const h = c < 1e-6 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360
  return { l: L, c, h, alpha: 1 }
}
