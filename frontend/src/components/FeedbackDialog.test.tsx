import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@/test/utils'
import { toast } from 'sonner'
import { FeedbackDialog } from './FeedbackDialog'
import { submitFeedback } from '@/services/feedbackApi'

vi.mock('@/services/feedbackApi', () => ({ submitFeedback: vi.fn() }))
vi.mock('@/lib/sessionId', () => ({ getSessionId: () => 'abcd1234' }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

describe('FeedbackDialog', () => {
  const onOpenChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  function renderOpen() {
    return render(<FeedbackDialog open onOpenChange={onOpenChange} />)
  }

  it('disables Send until a message is typed', () => {
    renderOpen()
    const send = screen.getByRole('button', { name: 'Send' })
    expect(send).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: '   ' } })
    expect(send).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'The guide is blank' } })
    expect(send).toBeEnabled()
  })

  it('submits the form with type, message, contact, and client context', async () => {
    vi.mocked(submitFeedback).mockResolvedValue()
    renderOpen()

    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'suggestion' } })
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: '  Add a sleep timer  ' } })
    fireEvent.change(screen.getByLabelText(/How can I reach you/), { target: { value: 'me@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(submitFeedback).toHaveBeenCalledTimes(1))
    const payload = vi.mocked(submitFeedback).mock.calls[0][0]
    expect(payload.type).toBe('suggestion')
    expect(payload.message).toBe('Add a sleep timer')
    expect(payload.contact).toBe('me@example.com')
    expect(payload.context).toMatchObject({
      sessionId: 'abcd1234',
      path: window.location.pathname,
      userAgent: navigator.userAgent,
    })
    expect(payload.context?.viewport).toMatch(/^\d+x\d+$/)
    expect(payload.context?.appVersion).toEqual(expect.any(String))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(toast.success).toHaveBeenCalledWith('Thanks, your feedback was sent')
  })

  it('shows the server explanation inline and keeps the draft on failure', async () => {
    vi.mocked(submitFeedback).mockRejectedValue(new Error('Please wait 30s before sending more feedback'))
    renderOpen()

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Still broken' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Please wait 30s before sending more feedback')
    expect(screen.getByLabelText('Message')).toHaveValue('Still broken')
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('closes on Cancel', () => {
    renderOpen()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('keeps key presses inside the dialog away from window-level player shortcuts', () => {
    // useVideoKeyboardShortcuts listens on window; the dialog must stop propagation before that.
    const onKeyDown = vi.fn()
    window.addEventListener('keydown', onKeyDown)
    renderOpen()

    fireEvent.keyDown(screen.getByLabelText('Message'), { key: ' ' })

    expect(onKeyDown).not.toHaveBeenCalled()
    window.removeEventListener('keydown', onKeyDown)
  })

  it('renders nothing when closed', () => {
    render(<FeedbackDialog open={false} onOpenChange={onOpenChange} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
