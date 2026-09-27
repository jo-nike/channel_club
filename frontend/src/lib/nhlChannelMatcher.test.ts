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

  describe('broadcast codes', () => {
    const ids = (network: string, channels: Channel[]) =>
      matchNetworkToChannels(network, channels).matched.map((c) => c.id)

    it('reaches hyphenated alias keys ("SN-PIT", "ROOT-NW")', () => {
      const channels = [
        ch('1', 'Sportsnet Pittsburgh'),
        ch('2', 'ROOT Sports Northwest'),
        ch('3', 'Sportsnet'),
      ]
      expect(ids('SN-PIT', channels)).toEqual(['1'])
      expect(ids('ROOT-NW', channels)).toEqual(['2'])
    })

    it('matches nothing for "USA": the country tag is dropped from every channel name, "USA Network" included', () => {
      const channels = [ch('1', 'US: ESPN'), ch('2', 'USA Network'), ch('3', 'CA-S: TSN 1')]
      expect(ids('USA', channels)).toEqual([])
    })

    it('matches nothing for a code with no letters or digits', () => {
      expect(ids('-', [ch('1', 'ESPN'), ch('2', 'TSN 1')])).toEqual([])
    })

    it('resolves "NHLN" to NHL Network', () => {
      const channels = [ch('1', 'US: NHL Network'), ch('2', 'US: NHL Center Ice 1')]
      expect(ids('NHLN', channels)).toEqual(['1'])
    })

    it('matches numbered TSN feeds on the whole number ("TSN5" vs "TSN 4")', () => {
      const channels = [ch('4', 'CA-S: TSN 4'), ch('5', 'CA-S: TSN 5'), ch('6', 'TSN5 HD')]
      expect(ids('TSN5', channels)).toEqual(['5', '6'])
    })

    it('offers every TSN feed for a plain "TSN" broadcast', () => {
      const channels = [
        ch('1', 'CA-S: TSN 1'),
        ch('2', 'CA-S: TSN 2'),
        ch('3', 'TSN'),
        ch('9', 'CA-S: TSN 9'),
      ]
      expect(ids('TSN', channels)).toEqual(['1', '2', '3'])
    })

    it('does not match "TSN" inside "Sportsnet"', () => {
      const channels = [ch('1', 'Sportsnet'), ch('2', 'CA-S: SPORTSNET ONTARIO')]
      expect(ids('TSN', channels)).toEqual([])
    })

    it('resolves "SN360" to Sportsnet 360, which plain "SN" leaves alone', () => {
      const channels = [ch('1', 'CA-S: SPORTSNET 360'), ch('2', 'CA-S: SPORTSNET ONTARIO')]
      expect(ids('SN360', channels)).toEqual(['1'])
      expect(ids('SN', channels)).toEqual(['2'])
    })

    it('resolves "TVAS2" to TVA Sports 2, which plain "TVAS" leaves alone', () => {
      const channels = [ch('1', 'TVA Sports 2'), ch('2', 'TVA Sports')]
      expect(ids('TVAS2', channels)).toEqual(['1'])
      expect(ids('TVAS', channels)).toEqual(['2'])
    })

    it('resolves "RDS2" to RDS 2 but not RDS', () => {
      const channels = [ch('1', 'CA: RDS 2'), ch('2', 'CA: RDS')]
      expect(ids('RDS2', channels)).toEqual(['1'])
      expect(ids('RDS', channels)).toEqual(['2'])
    })

    it('resolves "CITY" to Citytv', () => {
      const channels = [
        ch('1', 'CA: Citytv Toronto'),
        ch('2', 'CA-S: CITYTV VANCOUVER'),
        ch('3', 'City TV Calgary'),
        ch('4', 'CA: CBC Toronto'),
      ]
      expect(ids('CITY', channels)).toEqual(['1', '2', '3'])
    })

    it('resolves "ALT" to Altitude and "ALT2" to Altitude 2', () => {
      const channels = [ch('1', 'US: Altitude Sports'), ch('2', 'Altitude 2')]
      expect(ids('ALT', channels)).toEqual(['1'])
      expect(ids('ALT2', channels)).toEqual(['2'])
    })

    it('matches local affiliates listed with their channel number ("ABC 7", "KUSA 9")', () => {
      const channels = [ch('1', 'US: ABC 7'), ch('2', 'US: KUSA 9 Denver'), ch('3', 'US: NBC')]
      expect(ids('ABC', channels)).toEqual(['1'])
      expect(ids('KUSA', channels)).toEqual(['2'])
    })

    it('reads "+" as "plus" on both sides ("MSG+", "Victory+")', () => {
      const channels = [ch('1', 'US: MSG+'), ch('2', 'MSG Plus HD'), ch('3', 'Victory+')]
      expect(ids('MSG+', channels)).toEqual(['1', '2'])
      expect(ids('Victory+', channels)).toEqual(['3'])
    })

    it('does not match a network followed by another feed number ("ESPN" vs "ESPN 2")', () => {
      const channels = [ch('1', 'ESPN HD'), ch('2', 'ESPN 2')]
      expect(ids('ESPN', channels)).toEqual(['1'])
      expect(ids('ESPN2', channels)).toEqual(['2'])
    })
  })
})
