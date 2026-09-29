import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@/test/utils'
import { settingsState } from '@/test/settingsFixtures'
import type { TestKind } from '@/types/setup'
import { setField, type SettingsState } from '../model/configDraft'
import { ExtrasSection } from './ExtrasSection'

function Harness({ initial, onTest = vi.fn() }: { initial: SettingsState; onTest?: (kind: TestKind) => void }) {
  const [state, setState] = useState(initial)
  return (
    <ExtrasSection
      state={state}
      errors={{}}
      idPrefix="t"
      onField={(field, value) => setState((s) => ({ ...s, draft: setField(s.draft, field, value) }))}
      tests={{}}
      onTest={onTest}
    />
  )
}

describe('ExtrasSection', () => {
  it('starts with every extra off', () => {
    render(<Harness initial={settingsState()} />)

    for (const name of ['Chat', 'Clips', 'Chromecast', 'Feedback']) {
      expect(screen.getByRole('switch', { name })).toHaveAttribute('aria-checked', 'false')
    }
  })

  it('lets clips and casting be switched on when FFmpeg is there', () => {
    render(<Harness initial={settingsState()} />)

    expect(screen.getAllByText('FFmpeg ready')).toHaveLength(2)
    expect(screen.getByRole('switch', { name: 'Clips' })).toBeEnabled()
    expect(screen.getByRole('switch', { name: 'Chromecast' })).toBeEnabled()
  })

  it("won't switch clips or casting on without FFmpeg, but will switch them off", () => {
    render(<Harness initial={settingsState({ castEnabled: true }, {}, { ffmpeg: { ffmpeg: true, ffprobe: false } })} />)

    expect(screen.getAllByText('FFmpeg missing')).toHaveLength(2)
    expect(screen.getByRole('switch', { name: 'Clips' })).toBeDisabled()
    expect(screen.getByRole('switch', { name: 'Chromecast' })).toBeEnabled()
  })

  it('shows the Zipline settings only while clips and Zipline are both on', () => {
    render(<Harness initial={settingsState()} />)

    fireEvent.click(screen.getByRole('switch', { name: 'Clips' }))
    expect(screen.queryByLabelText('Zipline address')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch', { name: 'Share clips through Zipline' }))
    expect(screen.getByLabelText('Zipline address')).toBeInTheDocument()
    expect(screen.getByLabelText('Token')).toHaveAttribute('data-1p-ignore')
  })

  it('offers an optional GIPHY key with its own check once chat is on', () => {
    const onTest = vi.fn()
    render(<Harness initial={settingsState()} onTest={onTest} />)

    fireEvent.click(screen.getByRole('switch', { name: 'Chat' }))
    fireEvent.click(screen.getByRole('button', { name: 'Check key' }))

    expect(screen.getByRole('heading', { level: 3, name: 'GIFs in chat optional' })).toBeInTheDocument()
    expect(screen.getByLabelText('GIPHY API key')).toBeInTheDocument()
    expect(onTest).toHaveBeenCalledWith('giphy')
  })

  it('switches feedback on with ntfy.sh and a topic nobody could guess, and names a new one on request', () => {
    render(<Harness initial={settingsState()} />)

    fireEvent.click(screen.getByRole('switch', { name: 'Feedback' }))

    expect(screen.getByLabelText('ntfy server')).toHaveValue('https://ntfy.sh')
    const topic = screen.getByLabelText('Topic') as HTMLInputElement
    expect(topic.value).toMatch(/^channel-club-[a-z2-9]{12}$/)
    const first = topic.value

    fireEvent.click(screen.getByRole('button', { name: 'New name' }))

    expect(topic.value).toMatch(/^channel-club-[a-z2-9]{12}$/)
    expect(topic.value).not.toBe(first)
    expect(screen.getByRole('button', { name: 'Send a test notification' })).toBeInTheDocument()
  })

  it('keeps a saved ntfy server and topic when feedback is switched on again', () => {
    render(<Harness initial={settingsState({ ntfyUrl: 'https://ntfy.example.com', ntfyTopic: 'club-reports' })} />)

    fireEvent.click(screen.getByRole('switch', { name: 'Feedback' }))

    expect(screen.getByLabelText('ntfy server')).toHaveValue('https://ntfy.example.com')
    expect(screen.getByLabelText('Topic')).toHaveValue('club-reports')
  })
})
