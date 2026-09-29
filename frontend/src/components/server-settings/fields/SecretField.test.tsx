import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@/test/utils'
import type { SecretEntry } from '../model/configDraft'
import { SecretField } from './SecretField'

// A stand-in secret (spaced, so no scanner takes it for a real one)
const KEY = 'api key one'

function entry(overrides: Partial<SecretEntry> = {}): SecretEntry {
  return { draft: undefined, typed: false, saved: false, locked: false, ...overrides }
}

function renderSecret(props: Partial<Parameters<typeof SecretField>[0]> = {}) {
  const onChange = vi.fn()
  render(
    <SecretField
      id="setup-dispatcharrApiKey"
      label="API key"
      noun="API key"
      kind="key"
      placeholder="Paste the key"
      entry={entry()}
      onChange={onChange}
      {...props}
    />
  )
  return onChange
}

describe('SecretField', () => {
  it('asks for a key that no password manager saves', () => {
    const onChange = renderSecret()
    const input = screen.getByLabelText('API key')

    expect(input).toHaveAttribute('type', 'password')
    expect(input).toHaveAttribute('placeholder', 'Paste the key')
    expect(input).toHaveAttribute('autocomplete', 'off')
    expect(input).toHaveAttribute('data-1p-ignore')
    expect(input).toHaveAttribute('data-lpignore', 'true')
    expect(input).toHaveAttribute('data-bwignore')
    expect(input).toHaveClass('font-mono')
    expect(screen.getByRole('button', { name: 'Show API key' })).toBeInTheDocument()

    fireEvent.change(input, { target: { value: KEY } })
    expect(onChange).toHaveBeenCalledWith(KEY)
  })

  it('lets the browser save a password', () => {
    renderSecret({ kind: 'password', label: 'Password', noun: 'password' })

    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'new-password')
    expect(screen.getByLabelText('Password')).not.toHaveAttribute('data-1p-ignore')
  })

  it('reads Saved with Remove when one is saved, and never shows it', () => {
    const onChange = renderSecret({ entry: entry({ saved: true }) })

    const input = screen.getByLabelText('API key')
    expect(input).toHaveValue('')
    expect(input).toHaveAttribute('placeholder', 'Saved. Type a new one to replace it')
    expect(screen.getByText('Saved')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Remove API key' }))
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('offers to keep a key marked for removal', () => {
    const onChange = renderSecret({ entry: entry({ saved: true, draft: null }) })

    expect(screen.getByLabelText('API key')).toHaveAttribute('placeholder', 'Removed when you save')
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }))
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('shows what is typed over a saved one', () => {
    renderSecret({ entry: entry({ saved: true, draft: KEY, typed: true }) })

    expect(screen.getByLabelText('API key')).toHaveValue(KEY)
  })

  it('is read-only with no reveal or Remove when the environment sets it', () => {
    renderSecret({ entry: entry({ saved: true, locked: true }), lockedBy: ['DISPATCHARR_API_KEY'] })

    const input = screen.getByLabelText('API key')
    expect(input).toHaveAttribute('readonly')
    expect(input).toHaveAttribute('placeholder', 'Set in the environment')
    expect(input).toHaveAccessibleDescription("Set by DISPATCHARR_API_KEY in the server's environment.")
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('ties an error to the input', () => {
    renderSecret({ error: 'Paste the API key from your Dispatcharr profile page.' })

    const input = screen.getByLabelText('API key')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('Paste the API key from your Dispatcharr profile page.')
  })
})
