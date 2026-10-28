import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@/test/utils'
import { settingsState } from '@/test/settingsFixtures'
import type { TestKind } from '@/types/setup'
import { setField, setSourceOn, type SettingsState } from '../model/configDraft'
import { testFingerprint, type TestRecord } from '../model/testResults'
import type { SectionErrors } from '../model/validation'
import { SourcesSection } from './SourcesSection'
import { errorTargetId } from './types'

function Harness({
  initial,
  errors = {},
  tests = () => ({}),
  onTest = vi.fn(),
}: {
  initial: SettingsState
  errors?: SectionErrors
  tests?: (state: SettingsState) => Partial<Record<TestKind, TestRecord>>
  onTest?: (kind: TestKind) => void
}) {
  const [state, setState] = useState(initial)
  return (
    <SourcesSection
      state={state}
      errors={errors}
      idPrefix="t"
      onField={(field, value) => setState((s) => ({ ...s, draft: setField(s.draft, field, value) }))}
      onSource={(kind, on) => setState((s) => ({ ...s, draft: setSourceOn(s.draft, kind, on) }))}
      tests={tests(state)}
      onTest={onTest}
    />
  )
}

describe('SourcesSection', () => {
  it('shows a card per source, with the fields of the ones switched on', () => {
    render(<Harness initial={settingsState({ dispatcharrUrl: 'http://tv.lan' })} />)

    expect(screen.getByRole('switch', { name: 'Dispatcharr' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: 'ErsatzTV' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByLabelText('Address')).toHaveValue('http://tv.lan')
    expect(screen.getByLabelText('API key')).toBeInTheDocument()

    expect(screen.queryByLabelText('API key (optional)')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch', { name: 'ErsatzTV' }))

    expect(screen.getAllByLabelText('Address')).toHaveLength(2)
    expect(screen.getByLabelText('API key (optional)')).toBeInTheDocument()
  })

  it('says as an alert that a source is needed, on the switch the error focuses', () => {
    render(<Harness initial={settingsState()} errors={{ sources: 'Turn on Dispatcharr or ErsatzTV. The club needs at least one source of channels.' }} />)

    expect(screen.getByRole('alert')).toHaveTextContent('The club needs at least one source of channels.')
    expect(screen.getByRole('switch', { name: 'Dispatcharr' })).toHaveAttribute('id', errorTargetId('t', 'sources'))
  })

  it('ties an error to its field, whose id the error focuses', () => {
    render(
      <Harness
        initial={settingsState({}, { sources: { dispatcharr: true } })}
        errors={{ dispatcharrUrl: 'Enter the full address, starting with https:// or http://.' }}
      />
    )

    const address = screen.getByLabelText('Address')
    expect(address).toHaveAttribute('id', errorTargetId('t', 'dispatcharrUrl'))
    expect(address).toHaveAttribute('aria-invalid', 'true')
    expect(address).toHaveAccessibleDescription(expect.stringContaining('Enter the full address'))
  })

  it('keeps a source the environment sets switched on and read-only', () => {
    const state = settingsState(
      { dispatcharrUrl: 'http://env.lan', dispatcharrApiKey: { set: true } },
      {},
      { locked: { dispatcharrUrl: ['DISPATCHARR_URL', 'DISPATCHARR_API_KEY'], dispatcharrApiKey: ['DISPATCHARR_URL', 'DISPATCHARR_API_KEY'] } }
    )
    render(<Harness initial={state} />)

    expect(screen.getByRole('switch', { name: 'Dispatcharr' })).toBeDisabled()
    expect(screen.getByLabelText('Address')).toHaveAttribute('readonly')
    expect(screen.getByLabelText('API key')).toHaveAttribute('readonly')
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument()
  })

  it('shows a test result until an input it used changes, then offers the test again', () => {
    const initial = settingsState({ dispatcharrUrl: 'http://tv.lan', dispatcharrApiKey: { set: true } })
    // The test ran with the inputs as first shown
    const passed = (): Partial<Record<TestKind, TestRecord>> => ({
      dispatcharr: {
        fingerprint: testFingerprint(initial, 'dispatcharr'),
        running: false,
        result: { ok: true, counts: { channels: 37, groups: 4 } },
      },
    })
    render(<Harness initial={initial} tests={passed} />)

    const card = screen.getByRole('switch', { name: 'Dispatcharr' }).closest('[data-setting-card]') as HTMLElement
    const status = card.querySelector('[role="status"]')!
    expect(status).toHaveTextContent('This server reached Dispatcharr')
    expect(screen.getByRole('button', { name: 'Test again' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Address'), { target: { value: 'http://tv2.lan' } })

    expect(status).toBeEmptyDOMElement()
    expect(screen.getAllByRole('button', { name: 'Test connection' }).length).toBeGreaterThan(0)
  })

  it('asks for a test by kind', () => {
    const onTest = vi.fn()
    render(<Harness initial={settingsState({ ersatztvBaseUrl: 'http://etv.lan' })} onTest={onTest} />)

    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))

    expect(onTest).toHaveBeenCalledWith('ersatztv')
  })
})
