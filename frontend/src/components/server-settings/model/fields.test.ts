import { describe, it, expect } from 'vitest'
import { DEFAULT_VALUES } from '@/test/settingsFixtures'
import { ADVANCED_GROUPS, CONFIG_FIELDS, NUMBER_SPECS, SECRET_FIELDS, SECTION_FIELDS, isSecretField } from './fields'

describe('server settings fields', () => {
  it('lists every setting once', () => {
    expect(new Set(CONFIG_FIELDS).size).toBe(CONFIG_FIELDS.length)
    expect([...CONFIG_FIELDS].sort()).toEqual(Object.keys(DEFAULT_VALUES).sort())
  })

  it('puts each editable setting in exactly one section, never the ones linking Plex sets', () => {
    const inSections = Object.values(SECTION_FIELDS).flat()

    expect(new Set(inSections).size).toBe(inSections.length)
    expect([...inSections, 'plexServerToken', 'plexServerMachineId'].sort()).toEqual([...CONFIG_FIELDS].sort())
  })

  it('knows the secrets: the settings the server shows as {set}', () => {
    const secrets = CONFIG_FIELDS.filter((field) => typeof DEFAULT_VALUES[field] === 'object' && DEFAULT_VALUES[field] !== null
      && !Array.isArray(DEFAULT_VALUES[field]))

    expect([...SECRET_FIELDS].sort()).toEqual(secrets.sort())
    expect(isSecretField('ziplineToken')).toBe(true)
    expect(isSecretField('ziplineUrl')).toBe(false)
  })

  it('shows every number in Advanced with a range that holds its default', () => {
    const advanced = ADVANCED_GROUPS.flatMap((group) => [...group.fields])
    const scale = { MB: 1024 * 1024, KB: 1024, s: 1 }

    for (const [field, spec] of Object.entries(NUMBER_SPECS) as [keyof typeof NUMBER_SPECS, (typeof NUMBER_SPECS)[keyof typeof NUMBER_SPECS]][]) {
      expect(advanced).toContain(field)
      const shown = DEFAULT_VALUES[field] / scale[spec.unit ?? 's']
      expect(shown).toBeGreaterThanOrEqual(spec.min)
      expect(shown).toBeLessThanOrEqual(spec.max)
    }
  })
})
