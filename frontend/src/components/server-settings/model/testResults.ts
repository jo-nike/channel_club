import type { ConnectionTestResult, TestFailureReason, TestKind, TestValues } from '@/types/setup'
import { fieldValue, isLocked, secretEntry, secretFilled, type SettingsState } from './configDraft'
import { isSecretField, type EditableField } from './fields'
import { NTFY_TOPIC_PATTERN, urlError } from './validation'

/*
 * Connection tests: what each one sends, when its result still applies, and
 * how the result reads. The server answers with a reason and counts only;
 * the words are the app's.
 */

/** The settings each test uses. */
export const TEST_INPUTS: Record<TestKind, readonly EditableField[]> = {
  dispatcharr: ['dispatcharrUrl', 'dispatcharrApiKey'],
  ersatztv: ['ersatztvBaseUrl'],
  giphy: ['giphyApiKey'],
  zipline: ['ziplineUrl', 'ziplineToken'],
  ntfy: ['ntfyUrl', 'ntfyTopic', 'ntfyToken'],
}

const SERVICE: Record<TestKind, string> = {
  dispatcharr: 'Dispatcharr',
  ersatztv: 'ErsatzTV',
  giphy: 'GIPHY',
  zipline: 'Zipline',
  ntfy: 'ntfy',
}

/**
 * The test's inputs as they are now. A result shows only while this matches
 * the fingerprint it ran with: editing an input hides it, and a result that
 * arrives after an edit never shows. A secret counts as typed or as saved.
 */
export function testFingerprint(state: SettingsState, kind: TestKind): string {
  return JSON.stringify(
    TEST_INPUTS[kind].map((field) => {
      if (!isSecretField(field)) return fieldValue(state, field)
      const entry = secretEntry(state, field)
      if (entry.typed) return ['typed', entry.draft]
      return secretFilled(entry) ? ['saved'] : ['none']
    })
  )
}

/**
 * What a test sends: the values shown, and a secret only when a new one is
 * typed (left out, the server tests with the saved one). Locked settings are
 * left out too: the server tests with the environment's.
 */
export function testValues(state: SettingsState, kind: TestKind): TestValues {
  const values: TestValues = {}
  for (const field of TEST_INPUTS[kind]) {
    if (isLocked(state.view, field)) continue
    const key = field as keyof TestValues
    if (isSecretField(field)) {
      const entry = secretEntry(state, field)
      if (entry.typed && entry.draft) values[key] = entry.draft.trim()
    } else {
      values[key] = String(fieldValue(state, field)).trim()
    }
  }
  return values
}

/** The first input a test still needs, with what to say, or null when it can run. */
export function testInputError(state: SettingsState, kind: TestKind): { field: EditableField; message: string } | null {
  const needs: [EditableField, string | null][] = []
  const url = (field: 'dispatcharrUrl' | 'ersatztvBaseUrl' | 'ziplineUrl' | 'ntfyUrl', invalid: string) => {
    needs.push([field, urlError(fieldValue(state, field), invalid)])
  }
  const secret = (field: 'dispatcharrApiKey' | 'giphyApiKey' | 'ziplineToken', missing: string) => {
    needs.push([field, secretFilled(secretEntry(state, field)) ? null : missing])
  }
  switch (kind) {
    case 'dispatcharr':
      url('dispatcharrUrl', 'Enter the address first, starting with https:// or http://.')
      secret('dispatcharrApiKey', 'Paste the API key first.')
      break
    case 'ersatztv':
      url('ersatztvBaseUrl', 'Enter the address first, starting with http:// or https://.')
      break
    case 'giphy':
      secret('giphyApiKey', 'Paste a key to check it, or leave it blank for no GIFs.')
      break
    case 'zipline':
      url('ziplineUrl', 'Enter the Zipline address first.')
      secret('ziplineToken', 'Paste the token first.')
      break
    case 'ntfy':
      url('ntfyUrl', 'Enter the ntfy server address first.')
      needs.push([
        'ntfyTopic',
        NTFY_TOPIC_PATTERN.test(fieldValue(state, 'ntfyTopic').trim())
          ? null
          : 'Use only letters, numbers, - and _, up to 64 characters.',
      ])
      break
  }
  for (const [field, message] of needs) {
    if (message !== null && !isLocked(state.view, field)) return { field, message }
  }
  return null
}

/** A test someone started: the inputs it ran with, and how it went. */
export interface TestRecord {
  fingerprint: string
  running: boolean
  result?: ConnectionTestResult
  /** The request itself failed (network, a secret to enter again): the message to show */
  error?: string
}

/** The test for the inputs shown now; undefined once they changed since it ran. */
export function currentTest(record: TestRecord | undefined, state: SettingsState, kind: TestKind): TestRecord | undefined {
  return record !== undefined && record.fingerprint === testFingerprint(state, kind) ? record : undefined
}

export type TestStatus = 'untested' | 'running' | 'passed' | 'failed'

export function testStatus(record: TestRecord | undefined, state: SettingsState, kind: TestKind): TestStatus {
  const current = currentTest(record, state, kind)
  if (current === undefined) return 'untested'
  if (current.running) return 'running'
  return current.result?.ok === true ? 'passed' : 'failed'
}

/** One line of a test's outcome. */
export interface TestCheck {
  tone: 'ok' | 'bad'
  title: string
  detail: string
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** A tested address's host (with its port) for the words, or the text as typed when it won't parse. */
export function hostOf(text: string): string {
  try {
    return new URL(text.trim()).host
  } catch {
    return text.trim()
  }
}

function passed(kind: TestKind, result: ConnectionTestResult, topic: string): TestCheck {
  const counts = result.counts ?? {}
  switch (kind) {
    case 'dispatcharr': {
      const found = typeof counts.channels === 'number' && typeof counts.groups === 'number'
        ? ` · ${count(counts.channels, 'channel', 'channels')} in ${count(counts.groups, 'group', 'groups')}`
        : ''
      return { tone: 'ok', title: 'This server reached Dispatcharr', detail: `API key accepted${found}` }
    }
    case 'ersatztv': {
      const channels = typeof counts.channels === 'number' ? count(counts.channels, 'channel', 'channels') : 'Channels found'
      const days = counts.guideDays
      const guide = days === null || days === undefined
        ? "the guide didn't load in time"
        : days === 0
          ? 'no guide for the days ahead'
          : days === 1
            ? 'the guide covers the next day'
            : `the guide covers the next ${days} days`
      return { tone: 'ok', title: 'This server reached ErsatzTV', detail: `${channels} · ${guide}` }
    }
    case 'giphy':
      return { tone: 'ok', title: 'Key accepted', detail: 'The GIF button will show in chat.' }
    case 'zipline':
      return {
        tone: 'ok',
        title: 'Connected to Zipline',
        detail: counts.username ? `Signed in as ${counts.username}` : 'Token accepted',
      }
    case 'ntfy':
      return {
        tone: 'ok',
        title: 'Test notification sent',
        detail: `Subscribe to ${topic} in the ntfy app to get reports on your phone.`,
      }
  }
}

/** What a failure says, by reason, with the kinds that need their own words. */
const FAILED: Record<
  TestFailureReason,
  (host: string, kind: TestKind) => Omit<TestCheck, 'tone'>
> = {
  unreachable: (host, kind) => ({
    title: `Couldn't connect to ${host}`,
    detail: kind === 'giphy'
      ? "Check that this server can reach the internet."
      : `Check that ${SERVICE[kind]} is running and that this server can reach that address.`,
  }),
  timeout: (host, kind) => ({
    title: `${host} didn't answer in time`,
    detail: `Check that ${SERVICE[kind]} is running and that this server can reach it.`,
  }),
  auth: (host, kind) => {
    switch (kind) {
      case 'dispatcharr':
        return { title: 'Dispatcharr rejected the API key', detail: 'Create a key on your Dispatcharr profile page and paste it here.' }
      case 'giphy':
        return { title: 'GIPHY rejected this key', detail: 'Copy the key again from your app on developers.giphy.com.' }
      case 'zipline':
        return { title: 'Zipline rejected the token', detail: 'Copy the token again from your Zipline account settings.' }
      case 'ntfy':
        return { title: `${host} refused the message`, detail: 'This topic is protected. Add an access token that can publish to it.' }
      case 'ersatztv':
        return { title: `${host} asked for a sign-in`, detail: 'Channel Club reads ErsatzTV without one. Check the address.' }
    }
  },
  not_found: (host, kind) => {
    switch (kind) {
      case 'dispatcharr':
        return { title: `Dispatcharr's API isn't at ${host}`, detail: 'Check the address, and that Dispatcharr is 0.20 or later.' }
      case 'ersatztv':
        return { title: `No ErsatzTV channel list at ${host}`, detail: 'Channel Club reads /iptv/channels.m3u there. Check the address and port.' }
      case 'zipline':
        return { title: `Zipline's API isn't at ${host}`, detail: 'Use the base address of a Zipline 4 server.' }
      default:
        return { title: `${host} didn't know that address`, detail: `Check that this is ${SERVICE[kind]}'s address.` }
    }
  },
  http: (host, kind) => ({
    title: `${host} answered with an error`,
    detail: `${SERVICE[kind]} may be having trouble, or the address redirects. Channel Club doesn't follow redirects, so use the exact address.`,
  }),
  invalid: (host, kind) => ({
    title: `${host} doesn't look like ${SERVICE[kind]}`,
    detail: kind === 'zipline' ? 'Channel Club needs Zipline 4. Check the address.' : `It answered, but not the way ${SERVICE[kind]} does. Check the address.`,
  }),
}

/**
 * How a test result reads. `address` is the address tested (GIPHY has none);
 * `topic` is the ntfy topic.
 */
export function describeResult(
  kind: TestKind,
  result: ConnectionTestResult,
  { address, topic }: { address: string; topic: string }
): TestCheck {
  if (result.ok) return passed(kind, result, topic)
  const host = kind === 'giphy' ? 'GIPHY' : hostOf(address)
  const reason = result.reason ?? 'http'
  return { tone: 'bad', ...FAILED[reason](host, kind) }
}
