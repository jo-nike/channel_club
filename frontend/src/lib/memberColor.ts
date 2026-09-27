/**
 * Member colours: every club member gets one of eight hues, picked by hashing
 * their stable id, so a friend looks the same in chat, on channels and in the
 * guide on every device.
 *
 * The hue is fixed per member; lightness and chroma follow the theme mode.
 * Dark themes use oklch(0.80 0.13 h), at least 5.5:1 on every dark theme's
 * card, muted and background. Light themes use oklch(0.40 0.14 h): Peachy's
 * mid-tone surfaces need the darker value (0.50 falls to 3.2:1 there), and it
 * keeps at least 4.8:1 on every light theme's card, muted and background.
 * memberColor.test.ts checks every theme, so a new or edited theme can't
 * quietly drop below 4.5:1.
 */

import type { CSSProperties } from 'react'
import type { ThemeMode } from '@/types/theme'

/** Eight hues spaced around the wheel, so neighbours stay tellable apart. */
export const MEMBER_HUES = [25, 60, 95, 145, 190, 235, 285, 330] as const

const LIGHTNESS: Record<ThemeMode, number> = { dark: 0.8, light: 0.4 }
const CHROMA: Record<ThemeMode, number> = { dark: 0.13, light: 0.14 }

/**
 * Text on a solid member colour (avatar initials): the dark ink the dark
 * themes put on bright fills, and the near-white the light themes put on
 * their mid-tone fills.
 */
const INK: Record<ThemeMode, string> = { dark: 'oklch(0.2 0 0)', light: 'oklch(0.985 0 0)' }

/**
 * The id a member's colour hangs on: the opaque userId, which survives a
 * rename, or the name when the server sent no id (older servers).
 */
export function memberKey(member: { userId?: string; username: string }): string {
  return member.userId || member.username
}

/** 32-bit FNV-1a over the UTF-8 bytes of `text`. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** The member's hue, one of MEMBER_HUES. The same id always gives the same hue. */
export function memberHue(id: string): number {
  return MEMBER_HUES[fnv1a(id) % MEMBER_HUES.length]
}

/** The member's colour for a theme mode, as an oklch() string. */
export function memberColor(id: string, mode: ThemeMode): string {
  return `oklch(${LIGHTNESS[mode]} ${CHROMA[mode]} ${memberHue(id)})`
}

/** Text colour for use on a solid member colour in a theme mode. */
export function memberInk(mode: ThemeMode): string {
  return INK[mode]
}

/**
 * Inline style carrying a member's colours for both modes. Pair it with
 * MEMBER_COLOR_CLASS, which picks the pair for the current mode, so the
 * colour follows a theme switch without a re-render.
 */
export function memberColorStyle(id: string): CSSProperties {
  return {
    '--member-dark': memberColor(id, 'dark'),
    '--member-light': memberColor(id, 'light'),
    '--member-ink-dark': memberInk('dark'),
    '--member-ink-light': memberInk('light'),
  } as CSSProperties
}

/**
 * Sets `--member` (the colour) and `--member-ink` (text on it) from the pair
 * memberColorStyle provides, taking the dark values under the .dark root.
 * Use them as `text-(--member)`, `bg-(--member)` and `text-(--member-ink)`.
 */
export const MEMBER_COLOR_CLASS =
  '[--member:var(--member-light)] [--member-ink:var(--member-ink-light)] dark:[--member:var(--member-dark)] dark:[--member-ink:var(--member-ink-dark)]'
