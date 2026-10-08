import type { TestKind } from '@/types/setup'
import { fieldValue, type SettingsState } from '../model/configDraft'
import { currentTest, describeResult, type TestCheck, type TestRecord } from '../model/testResults'

const ADDRESS = {
  dispatcharr: 'dispatcharrUrl',
  ersatztv: 'ersatztvBaseUrl',
  giphy: null,
  zipline: 'ziplineUrl',
  ntfy: 'ntfyUrl',
} as const satisfies Record<TestKind, string | null>

/** What a section's TestConnection shows: the test for the inputs as they are now, or nothing. */
export function testView(
  state: SettingsState,
  tests: Partial<Record<TestKind, TestRecord>>,
  kind: TestKind
): { running: boolean; checks: TestCheck[]; error?: string } {
  const current = currentTest(tests[kind], state, kind)
  if (current === undefined) return { running: false, checks: [] }
  const address = ADDRESS[kind]
  const checks = current.result
    ? [describeResult(kind, current.result, {
        address: address ? fieldValue(state, address) : '',
        topic: fieldValue(state, 'ntfyTopic').trim(),
      })]
    : []
  return { running: current.running, checks, error: current.error }
}
