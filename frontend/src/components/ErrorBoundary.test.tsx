import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@/test/utils'
import { ErrorBoundary } from './ErrorBoundary'
import { logger } from '@/lib/logger'

const crash = { enabled: true }

function Fragile({ label }: { label: string }) {
  if (crash.enabled) throw new Error('fragile broke')
  return <p>{label}</p>
}

const fallback = ({ error, reset }: { error: Error; reset: () => void }) => (
  <div>
    <p>Fallback: {error.message}</p>
    <button onClick={reset}>Try again</button>
  </div>
)

describe('ErrorBoundary', () => {
  beforeEach(() => {
    crash.enabled = true
    // React reports caught render errors to console.error; keep the output quiet.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the children when nothing throws', () => {
    crash.enabled = false
    render(
      <ErrorBoundary fallback={fallback}>
        <Fragile label="All good" />
      </ErrorBoundary>
    )

    expect(screen.getByText('All good')).toBeInTheDocument()
    expect(screen.queryByText(/Fallback/)).not.toBeInTheDocument()
  })

  it('shows the fallback and logs when a child throws, leaving siblings rendered', () => {
    const logError = vi.spyOn(logger, 'error')

    render(
      <div>
        <p>Sibling</p>
        <ErrorBoundary name="Player" fallback={fallback}>
          <Fragile label="Never shown" />
        </ErrorBoundary>
      </div>
    )

    expect(screen.getByText('Fallback: fragile broke')).toBeInTheDocument()
    expect(screen.getByText('Sibling')).toBeInTheDocument()
    expect(logError).toHaveBeenCalledWith(
      'Player',
      'Render error',
      expect.objectContaining({ message: 'fragile broke' }),
      expect.any(String)
    )
  })

  it('renders the children again when resetKey changes', () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="a" fallback={fallback}>
        <Fragile label="Channel B" />
      </ErrorBoundary>
    )
    expect(screen.getByText('Fallback: fragile broke')).toBeInTheDocument()

    crash.enabled = false
    // Same key: the boundary stays in its error state
    rerender(
      <ErrorBoundary resetKey="a" fallback={fallback}>
        <Fragile label="Channel B" />
      </ErrorBoundary>
    )
    expect(screen.getByText('Fallback: fragile broke')).toBeInTheDocument()

    rerender(
      <ErrorBoundary resetKey="b" fallback={fallback}>
        <Fragile label="Channel B" />
      </ErrorBoundary>
    )
    expect(screen.getByText('Channel B')).toBeInTheDocument()
    expect(screen.queryByText(/Fallback/)).not.toBeInTheDocument()
  })

  it('renders the children again when the fallback calls reset', () => {
    render(
      <ErrorBoundary fallback={fallback}>
        <Fragile label="Recovered" />
      </ErrorBoundary>
    )

    crash.enabled = false
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(screen.getByText('Recovered')).toBeInTheDocument()
  })
})
