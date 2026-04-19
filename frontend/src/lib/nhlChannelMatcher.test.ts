import { describe, expect, it } from 'vitest'
import type { Channel } from '@/types'
import { matchNetworkToChannels } from './nhlChannelMatcher'

const ch = (id: string, name: string): Channel => ({
  id,
  name,
  streamUrl: `stream://${id}`,
  guideId: id,
})

describe('matchNetworkToChannels', () => {
  it('auto-matches a direct network name substring', () => {
    const channels = [ch('1', 'ESPN HD'), ch('2', 'TNT'), ch('3', 'CBC')]
    const result = matchNetworkToChannels('ESPN', channels)
    expect(result.isOverride).toBe(false)
    expect(result.matched).toHaveLength(1)
    expect(result.matched[0].id).toBe('1')
  })

  it('resolves NHL code "SN" via alias table to Sportsnet channels', () => {
    const channels = [ch('1', 'Sportsnet HD'), ch('2', 'TSN 1'), ch('3', 'TVA Sports')]
    const result = matchNetworkToChannels('SN', channels)
    expect(result.matched.map((c) => c.id)).toEqual(['1'])
  })

  it('resolves "TVAS" to TVA Sports', () => {
    const channels = [ch('1', 'TVA Sports HD'), ch('2', 'Sportsnet')]
    const result = matchNetworkToChannels('TVAS', channels)
    expect(result.matched).toHaveLength(1)
    expect(result.matched[0].id).toBe('1')
  })

  it('resolves "FDSNSO" to FanDuel Sports South (or Bally fallback)', () => {
    const channels = [ch('1', 'Bally Sports South'), ch('2', 'ESPN')]
    const result = matchNetworkToChannels('FDSNSO', channels)
    expect(result.matched.map((c) => c.id)).toEqual(['1'])
  })

  it('returns multiple matches when more than one channel qualifies', () => {
    const channels = [ch('1', 'Sportsnet HD'), ch('2', 'Sportsnet West'), ch('3', 'TSN')]
    const result = matchNetworkToChannels('SN', channels)
    expect(result.matched.map((c) => c.id).sort()).toEqual(['1', '2'])
  })

  it('returns empty matched array when no channel fits', () => {
    const channels = [ch('1', 'ESPN'), ch('2', 'TNT')]
    const result = matchNetworkToChannels('Victory+', channels)
    expect(result.matched).toEqual([])
    expect(result.isOverride).toBe(false)
  })

  it('override wins over auto-match', () => {
    const channels = [ch('1', 'ESPN HD'), ch('2', 'ESPN 2')]
    const result = matchNetworkToChannels('ESPN', channels, { ESPN: '2' })
    expect(result.isOverride).toBe(true)
    expect(result.matched.map((c) => c.id)).toEqual(['2'])
  })

  it('falls back to auto-match when override points to missing channel', () => {
    const channels = [ch('1', 'ESPN HD')]
    const result = matchNetworkToChannels('ESPN', channels, { ESPN: 'deleted-id' })
    expect(result.isOverride).toBe(false)
    expect(result.matched.map((c) => c.id)).toEqual(['1'])
  })

  it('is case-insensitive', () => {
    const channels = [ch('1', 'espn hd')]
    const result = matchNetworkToChannels('espn', channels)
    expect(result.matched).toHaveLength(1)
  })
})
