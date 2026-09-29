import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, within } from '@/test/utils'
import { settingsState } from '@/test/settingsFixtures'
import type { EnvVariable } from '@/types/setup'
import { setField, type SettingsState } from '../model/configDraft'
import type { SectionErrors } from '../model/validation'
import { AdvancedSection } from './AdvancedSection'
import { EnvironmentList } from './EnvironmentList'

function Harness({ initial, errors = {}, onReset = vi.fn() }: { initial: SettingsState; errors?: SectionErrors; onReset?: () => void }) {
  const [state, setState] = useState(initial)
  return (
    <AdvancedSection
      state={state}
      errors={errors}
      idPrefix="t"
      onField={(field, value) => setState((s) => ({ ...s, draft: setField(s.draft, field, value) }))}
      onReset={onReset}
    />
  )
}

describe('AdvancedSection', () => {
  it('groups the settings under sans-serif headings, in the units they are shown in', () => {
    render(<Harness initial={settingsState()} />)

    for (const title of ['Chromecast', 'Clips', 'Feedback', 'Server']) {
      expect(screen.getByRole('heading', { level: 3, name: title })).toHaveClass('font-sans', 'font-semibold')
    }
    const clips = screen.getByRole('region', { name: 'Clips' })
    expect(within(clips).getByLabelText('Largest export')).toHaveValue('256')
    expect(within(clips).getByText('MB')).toBeInTheDocument()
    expect(screen.getByLabelText('Largest request')).toHaveValue('64')
    expect(screen.getByLabelText('Log level')).toHaveValue('INFO')
  })

  it('marks a setting that differs from its default as changed', () => {
    render(<Harness initial={settingsState({ castHlsListSize: 9 })} />)

    expect(screen.getByLabelText('Segments in the playlist · changed')).toHaveValue('9')

    fireEvent.change(screen.getByLabelText('Segments in the playlist · changed'), { target: { value: '5' } })

    expect(screen.getByLabelText('Segments in the playlist')).toHaveValue('5')
  })

  it('marks nothing locked as changed', () => {
    render(<Harness initial={settingsState({ castHlsListSize: 9 }, {}, { locked: { castHlsListSize: ['CAST_HLS_LIST_SIZE'] } })} />)

    expect(screen.getByLabelText('Segments in the playlist')).toHaveValue('9')
  })

  it('puts things back to their defaults on request', () => {
    const onReset = vi.fn()
    render(<Harness initial={settingsState()} onReset={onReset} />)

    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }))

    expect(onReset).toHaveBeenCalledTimes(1)
  })

  it('shows a log level the environment sets as locked', () => {
    render(<Harness initial={settingsState({ logLevel: 'DEBUG' }, {}, { locked: { logLevel: ['LOG_LEVEL'] } })} />)

    const select = screen.getByLabelText('Log level')
    expect(select).toBeDisabled()
    expect(select).toHaveAccessibleDescription("Log level is set by LOG_LEVEL in the server's environment.")
  })

  it('ties errors to their settings', () => {
    render(
      <Harness
        initial={settingsState()}
        errors={{ castHlsListSize: 'Use a whole number from 2 to 30.', ersatztvLogoOrigins: 'Use up to 20 addresses.' }}
      />
    )

    expect(screen.getByLabelText('Segments in the playlist')).toHaveAccessibleDescription('Use a whole number from 2 to 30.')
    expect(screen.getByLabelText('Extra logo sources')).toHaveAttribute('aria-invalid', 'true')
  })

  it('takes the logo sources as one line', () => {
    render(<Harness initial={settingsState({ ersatztvLogoOrigins: ['https://a.example', 'https://b.example'] })} />)

    expect(screen.getByLabelText('Extra logo sources')).toHaveValue('https://a.example, https://b.example')
  })
})

describe('EnvironmentList', () => {
  it('lists each variable with its value, a secret only as set', () => {
    const environment: EnvVariable[] = [
      { env: 'DISPATCHARR_URL', field: 'dispatcharrUrl', value: 'https://dispatcharr.example.com', secret: false },
      { env: 'DISPATCHARR_API_KEY', field: 'dispatcharrApiKey', value: null, secret: true },
      { env: 'LOG_FORMAT', field: null, value: 'json', secret: false },
      { env: 'CORS_ORIGINS', field: null, value: '', secret: false },
    ]
    render(<EnvironmentList environment={environment} />)

    const items = screen.getAllByRole('listitem').map((item) => item.textContent)
    expect(items).toEqual([
      'DISPATCHARR_URLhttps://dispatcharr.example.com',
      'DISPATCHARR_API_KEYset, hidden',
      'LOG_FORMATjson',
      'CORS_ORIGINS(empty)',
    ])
  })
})
