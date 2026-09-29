import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  CONFIG_FIELDS,
  LOG_LEVELS,
  MAX_LOGO_ORIGINS,
  NUMBER_SPECS,
  SECRET_FIELDS,
  SECTION_FIELDS,
  UNIT_BYTES,
  type NumberField,
} from '@/components/server-settings/model/fields'
import { describeResult, TEST_INPUTS } from '@/components/server-settings/model/testResults'
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@/components/server-settings/model/validation'
import { configView } from '@/test/settingsFixtures'
import type { TestFailureReason, TestKind } from './setup'

/*
 * types/setup.ts is written by hand to mirror the server's models. The
 * server's committed OpenAPI snapshot changes with them, so these compare the
 * two: a setting, a code or a range changed on one side fails here, not in
 * the browser.
 */

interface Schema {
  properties?: Record<string, Schema>
  anyOf?: Schema[]
  enum?: string[]
  $ref?: string
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  maxItems?: number
}

const openapi = JSON.parse(readFileSync('../backend/tests/snapshots/openapi.json', 'utf8')) as {
  components: { schemas: Record<string, Schema> }
}
const schemas = openapi.components.schemas

function schema(name: string): Schema {
  const found = schemas[name]
  if (!found) throw new Error(`No ${name} in the OpenAPI snapshot`)
  return found
}

function propertyNames(name: string): string[] {
  return Object.keys(schema(name).properties ?? {}).sort()
}

function property(name: string, field: string): Schema {
  const found = schema(name).properties?.[field]
  if (!found) throw new Error(`No ${name}.${field} in the OpenAPI snapshot`)
  return found
}

/** A property's own schema, past an optional field's anyOf with null. */
function valueSchema(name: string, field: string): Schema {
  const found = property(name, field)
  return found.anyOf?.find((option) => (option as { type?: string }).type !== 'null') ?? found
}

function enumOf(name: string, field: string): string[] | undefined {
  return valueSchema(name, field).enum
}

const sorted = (items: readonly string[]) => [...items].sort()

describe('the settings, as the server names them', () => {
  it('lists every setting GET /api/admin/config sends', () => {
    expect(sorted(CONFIG_FIELDS)).toEqual(propertyNames('ConfigValues'))
  })

  it('edits, in its sections, every setting PUT /api/admin/config takes', () => {
    expect(sorted(Object.values(SECTION_FIELDS).flat())).toEqual(propertyNames('ConfigPatch'))
  })

  it('treats as secrets the settings the server shows only as set', () => {
    const shownAsSet = propertyNames('ConfigValues').filter(
      (field) => property('ConfigValues', field).$ref === '#/components/schemas/SecretState'
    )
    expect(sorted(SECRET_FIELDS)).toEqual(shownAsSet)
  })

  it('reads every part of the settings view', () => {
    expect(sorted(Object.keys(configView()))).toEqual(propertyNames('AdminConfigResponse'))
    expect(sorted(Object.keys(configView().storage))).toEqual(propertyNames('ConfigStorage'))
    expect(sorted(Object.keys(configView().ffmpeg))).toEqual(propertyNames('FfmpegTools'))
  })
})

describe('the ranges the server holds settings to', () => {
  it.each(Object.keys(NUMBER_SPECS) as NumberField[])('%s', (field) => {
    const { min, max, unit } = NUMBER_SPECS[field]
    const bytes = unit === 'MB' || unit === 'KB' ? UNIT_BYTES[unit] : 1
    const range = valueSchema('ConfigPatch', field)
    expect({ minimum: min * bytes, maximum: max * bytes }).toEqual({ minimum: range.minimum, maximum: range.maximum })
  })

  it('takes passwords of the same lengths', () => {
    for (const [name, field] of [
      ['ConfigPatch', 'adminPassword'],
      ['ConfigPatch', 'viewerPassword'],
      ['PasswordClaim', 'password'],
    ] as const) {
      const lengths = valueSchema(name, field)
      expect({ name, field, min: lengths.minLength, max: lengths.maxLength }).toEqual({
        name,
        field,
        min: MIN_PASSWORD_LENGTH,
        max: MAX_PASSWORD_LENGTH,
      })
    }
  })

  it('keeps as many extra logo sources', () => {
    expect(valueSchema('ConfigPatch', 'ersatztvLogoOrigins').maxItems).toBe(MAX_LOGO_ORIGINS)
  })

  it('offers the same log levels and roles', () => {
    expect(LOG_LEVELS).toEqual(enumOf('ConfigPatch', 'logLevel'))
    expect(['viewer', 'admin']).toEqual(enumOf('ConfigPatch', 'plexDefaultRole'))
  })
})

describe('connection tests', () => {
  it('runs the kinds the server tests, with the values it takes', () => {
    expect(sorted(Object.keys(TEST_INPUTS))).toEqual(sorted(enumOf('ProbeRequest', 'kind') ?? []))
    expect(sorted([...new Set(Object.values(TEST_INPUTS).flat())])).toEqual(propertyNames('ProbeValues'))
  })

  it('words every reason a test can fail for', () => {
    const reasons = enumOf('ProbeResult', 'reason') as TestFailureReason[]
    expect(reasons.length).toBeGreaterThan(0)
    for (const reason of reasons) {
      for (const kind of Object.keys(TEST_INPUTS) as TestKind[]) {
        const check = describeResult(kind, { ok: false, reason }, { address: 'http://tv.lan', topic: 'club' })
        expect(check.title, `${kind}: ${reason}`).not.toBe('')
      }
    }
  })

  it('reads what a test found', () => {
    expect(propertyNames('ProbeResult')).toEqual(['counts', 'ok', 'reason'])
    expect(propertyNames('ProbeCounts')).toEqual(['channels', 'groups', 'guideDays', 'username'])
  })
})

describe('setup', () => {
  it('knows every state setup can be in', () => {
    expect(enumOf('SetupStatusResponse', 'setupState')).toEqual(['unclaimed', 'claimed', 'complete'])
    expect(enumOf('AuthConfigResponse', 'setupState')).toEqual(['unclaimed', 'claimed', 'complete'])
  })

  it('reads the setup and Plex answers it relies on', () => {
    expect(propertyNames('SetupStatusResponse')).toEqual(['envLocked', 'setupState'])
    expect(propertyNames('EnvLock')).toEqual(['env', 'field'])
    expect(propertyNames('PlexServersResponse')).toEqual(['account', 'servers'])
    expect(propertyNames('PlexServer')).toEqual(['lastSeenAt', 'machineId', 'memberCount', 'name', 'online'])
    expect(propertyNames('PlexMemberView')).toEqual(['admin', 'managed', 'owner', 'plexId', 'username'])
    expect(propertyNames('EnvVariable')).toEqual(['env', 'field', 'secret', 'value'])
    expect(propertyNames('SetupCompleteResponse')).toEqual(['dispatcharrChannels', 'ersatztvChannels', 'features', 'plexServerName'])
    expect(propertyNames('SetupFeatures')).toEqual(['cast', 'chat', 'clips', 'feedback', 'gifs'])
    expect(propertyNames('ConfigUpdateResponse')).toEqual(['config', 'warnings'])
    expect(enumOf('ConfigWarning', 'code')).toEqual(['zipline_unavailable', 'feedback_unavailable'])
  })

  it('sends the bodies the server expects', () => {
    expect(propertyNames('PasswordClaim')).toEqual(['method', 'password', 'username'])
    expect(propertyNames('PlexClaim')).toEqual(['authToken', 'machineId', 'method'])
    expect(propertyNames('PlexServerLink')).toEqual(['authToken', 'machineId'])
  })
})
