import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@/test/utils'
import { FeedbackButton } from './FeedbackButton'
import { useFeedbackFeature } from '@/hooks/useFeedbackFeature'

vi.mock('@/hooks/useFeedbackFeature', () => ({
  useFeedbackFeature: vi.fn(),
}))
vi.mock('@/components/FeedbackDialog', () => ({
  FeedbackDialog: ({ open }: { open: boolean }) => (open ? <div role="dialog">Feedback form</div> : null),
}))

describe('FeedbackButton', () => {
  beforeEach(() => {
    vi.mocked(useFeedbackFeature).mockReturnValue({ isEnabled: true, isLoading: false })
  })

  it('renders when feedback is configured', () => {
    render(<FeedbackButton />)
    expect(screen.getByRole('button', { name: 'Send feedback' })).toBeInTheDocument()
  })

  it('renders nothing when feedback is not configured', () => {
    vi.mocked(useFeedbackFeature).mockReturnValue({ isEnabled: false, isLoading: false })
    render(<FeedbackButton />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('opens the dialog on click', () => {
    render(<FeedbackButton />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }))

    expect(screen.getByRole('dialog')).toHaveTextContent('Feedback form')
  })
})
