import { describe, it, expect, vi, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, act } from '@/test/utils'
import { focusOverrides } from '@/test/focus'
import { UrlField, WARNING_DELAY_MS } from './UrlField'

const LOCALHOST_WARNING = 'Other devices can\'t reach "localhost". Use the address phones and TVs on your network use.'

function Controlled({ initial = '', lockedBy }: { initial?: string; lockedBy?: readonly string[] }) {
  const [value, setValue] = useState(initial)
  return (
    <UrlField
      id="setup-dispatcharrUrl"
      label="Address"
      value={value}
      onChange={setValue}
      warn="dispatcharr"
      help="Phones and TVs play streams straight from this address."
      lockedBy={lockedBy}
    />
  )
}

describe('UrlField', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('is a URL input that no browser fills or spell-checks', () => {
    render(<Controlled />)

    const input = screen.getByLabelText('Address')
    expect(input).toHaveAttribute('type', 'url')
    expect(input).toHaveAttribute('inputmode', 'url')
    expect(input).toHaveAttribute('autocomplete', 'off')
    expect(input).toHaveAttribute('spellcheck', 'false')
    expect(input).toHaveClass('h-11', 'text-base')
    expect(focusOverrides(input)).toEqual([])
  })

  it('warns 350ms after typing stops, not while typing', () => {
    vi.useFakeTimers()
    render(<Controlled />)
    const input = screen.getByLabelText('Address')

    fireEvent.change(input, { target: { value: 'http://localhost:9191' } })
    act(() => vi.advanceTimersByTime(WARNING_DELAY_MS - 50))
    expect(screen.queryByText(LOCALHOST_WARNING)).not.toBeInTheDocument()

    act(() => vi.advanceTimersByTime(50))
    expect(screen.getByText(LOCALHOST_WARNING)).toBeInTheDocument()
    expect(input).toHaveAccessibleDescription(`Phones and TVs play streams straight from this address. ${LOCALHOST_WARNING}`)
  })

  it('warns at once on leaving the field', () => {
    vi.useFakeTimers()
    render(<Controlled />)
    const input = screen.getByLabelText('Address')

    fireEvent.change(input, { target: { value: 'http://localhost:9191' } })
    fireEvent.blur(input)

    expect(screen.getByText(LOCALHOST_WARNING)).toBeInTheDocument()
  })

  it('warns about a saved address straight away', () => {
    render(<Controlled initial="http://127.0.0.1:9191" />)

    expect(screen.getByText(LOCALHOST_WARNING)).toBeInTheDocument()
  })

  it('is read-only with a lock and no warning when the environment sets it', () => {
    render(<Controlled initial="http://localhost:9191" lockedBy={['DISPATCHARR_URL']} />)

    const input = screen.getByLabelText('Address')
    expect(input).toHaveAttribute('readonly')
    expect(input).toHaveAccessibleDescription("Set by DISPATCHARR_URL in the server's environment.")
    expect(screen.queryByText(LOCALHOST_WARNING)).not.toBeInTheDocument()
  })
})
