import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@/test/utils'
import { TestConnection } from './TestConnection'

const PASSED = { tone: 'ok' as const, title: 'This server reached Dispatcharr', detail: 'API key accepted · 37 channels in 4 groups' }

describe('TestConnection', () => {
  it('offers the test, which never submits a form around it', () => {
    const onTest = vi.fn()
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <TestConnection running={false} checks={[]} onTest={onTest} />
      </form>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))

    expect(onTest).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('says it is testing, and is disabled, while it runs', () => {
    render(<TestConnection running checks={[]} onTest={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Testing…' })).toBeDisabled()
  })

  it('shows the result in a status region and offers to test again', () => {
    render(<TestConnection running={false} checks={[PASSED]} onTest={vi.fn()} />)

    expect(screen.getByRole('status')).toHaveTextContent('This server reached DispatcharrAPI key accepted · 37 channels in 4 groups')
    expect(screen.getByRole('button', { name: 'Test again' })).toBeEnabled()
  })

  it('keeps the status region in place before any result, so the first one is announced', () => {
    render(<TestConnection running={false} checks={[]} onTest={vi.fn()} />)

    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
  })

  it('goes back to its first label once the result no longer applies', () => {
    const { rerender } = render(<TestConnection running={false} checks={[PASSED]} onTest={vi.fn()} />)

    // The caller drops the checks when an input changes (the fingerprint moved on)
    rerender(<TestConnection running={false} checks={[]} onTest={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Test connection' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('shows a request that failed as a failed line', () => {
    render(<TestConnection running={false} checks={[]} error="Couldn't reach Channel Club's server." onTest={vi.fn()} />)

    expect(screen.getByRole('status')).toHaveTextContent("Couldn't reach Channel Club's server.")
    expect(screen.getByRole('button', { name: 'Test again' })).toBeInTheDocument()
  })

  it('takes its own labels, e.g. for ntfy', () => {
    render(
      <TestConnection label="Send a test notification" busyLabel="Sending…" againLabel="Send another" running={false} checks={[PASSED]} onTest={vi.fn()} />
    )

    expect(screen.getByRole('button', { name: 'Send another' })).toBeInTheDocument()
  })

  it('staggers the rows after the first', () => {
    render(<TestConnection running={false} checks={[PASSED, { ...PASSED, title: 'Second' }]} onTest={vi.fn()} />)

    const rows = screen.getByRole('status').children
    expect((rows[0] as HTMLElement).style.animationDelay).toBe('')
    expect((rows[1] as HTMLElement).style.animationDelay).toBe('110ms')
  })
})
