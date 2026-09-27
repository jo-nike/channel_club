import { describe, it, expect } from 'vitest'
import { contrast, parseOklch } from './color'
import { themes } from './themes'
import {
  MEMBER_HUES,
  memberColor,
  memberColorStyle,
  memberHue,
  memberInk,
  memberKey,
} from './memberColor'
import type { ThemeMode } from '@/types/theme'

const ids = Array.from({ length: 200 }, (_, i) => `u_${i.toString(16).padStart(16, '0')}`)

describe('memberHue', () => {
  it('gives the same id the same hue every time', () => {
    for (const id of ids.slice(0, 20)) {
      expect(memberHue(id)).toBe(memberHue(id))
    }
    expect(memberHue('u_3f2a9c0d1e4b5a67')).toBe(memberHue('u_3f2a9c0d1e4b5a67'))
  })

  it('is FNV-1a, so colours stay put across releases', () => {
    // FNV-1a offset basis for the empty string; 0xe40c292c for "a"
    expect(memberHue('')).toBe(MEMBER_HUES[0x811c9dc5 % 8])
    expect(memberHue('a')).toBe(MEMBER_HUES[0xe40c292c % 8])
  })

  it('reaches all eight hues', () => {
    expect(new Set(ids.map(memberHue))).toEqual(new Set(MEMBER_HUES))
  })

  it('hashes non-ASCII names', () => {
    expect(MEMBER_HUES).toContain(memberHue('Zoë 🎬'))
  })
})

describe('memberKey', () => {
  it('prefers the stable userId over the renameable name', () => {
    expect(memberKey({ userId: 'u_abc', username: 'Sam' })).toBe('u_abc')
    expect(memberKey({ userId: 'u_abc', username: 'Samantha' })).toBe('u_abc')
  })

  it('falls back to the name when there is no userId', () => {
    expect(memberKey({ username: 'Sam' })).toBe('Sam')
    expect(memberKey({ userId: '', username: 'Sam' })).toBe('Sam')
  })
})

describe('memberColor', () => {
  it('is light and soft in dark themes, darker in light themes, on the member hue', () => {
    const hue = memberHue('u_abc')
    expect(parseOklch(memberColor('u_abc', 'dark'))).toEqual({ l: 0.8, c: 0.13, h: hue, alpha: 1 })
    expect(parseOklch(memberColor('u_abc', 'light'))).toEqual({ l: 0.4, c: 0.14, h: hue, alpha: 1 })
  })

  // Names sit on the chat panel (card when docked, background in the sheet,
  // overlay and inline chat) and on muted rows. Every theme is checked, so a
  // new or edited theme can't drop a name below 4.5:1 unnoticed
  const surfaces = ['card', 'muted', 'background'] as const

  for (const theme of Object.values(themes)) {
    for (const key of surfaces) {
      it(`keeps every hue at 4.5:1 or more on the ${theme.name} ${key}`, () => {
        for (const hue of MEMBER_HUES) {
          const id = ids.find((candidate) => memberHue(candidate) === hue)!
          expect(contrast(memberColor(id, theme.mode), theme.colors[key])).toBeGreaterThanOrEqual(4.5)
        }
      })
    }
  }

  it('keeps avatar initials at 4.5:1 or more on every hue in both modes', () => {
    for (const mode of ['dark', 'light'] as ThemeMode[]) {
      for (const hue of MEMBER_HUES) {
        const id = ids.find((candidate) => memberHue(candidate) === hue)!
        expect(contrast(memberInk(mode), memberColor(id, mode))).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})

describe('memberColorStyle', () => {
  it('carries both modes so the colour follows a theme switch', () => {
    expect(memberColorStyle('u_abc')).toEqual({
      '--member-dark': memberColor('u_abc', 'dark'),
      '--member-light': memberColor('u_abc', 'light'),
      '--member-ink-dark': memberInk('dark'),
      '--member-ink-light': memberInk('light'),
    })
  })
})
