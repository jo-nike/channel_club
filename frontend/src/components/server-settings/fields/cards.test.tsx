import { describe, it, expect, vi } from 'vitest'
import { Clapperboard, Tv } from 'lucide-react'
import { render, screen, fireEvent } from '@/test/utils'
import { Callout } from './Callout'
import { Chip } from './Chip'
import { CardHeadingLevel } from './headingLevel'
import { NativeSelect } from './NativeSelect'
import { PasswordRules } from './PasswordRules'
import { SettingCard } from './SettingCard'
import { Subsection } from './Subsection'
import { ToggleRow } from './ToggleRow'

describe('SettingCard', () => {
  function renderCard(checked: boolean, onChange = vi.fn()) {
    render(
      <SettingCard
        id="card-clips"
        icon={Clapperboard}
        title="Clips"
        badge={<Chip tone="ok">FFmpeg ready</Chip>}
        description="Anyone can grab the last minute of a channel."
        toggle={{ checked, onChange }}
      >
        <p>Zipline settings</p>
      </SettingCard>
    )
    return onChange
  }

  it('has a sans-serif title heading and a switch named and described by it', () => {
    renderCard(false)

    const heading = screen.getByRole('heading', { level: 2, name: 'Clips FFmpeg ready' })
    expect(heading).toHaveClass('font-sans', 'font-semibold')
    const toggle = screen.getByRole('switch', { name: 'Clips' })
    expect(toggle).toHaveAccessibleDescription('Anyone can grab the last minute of a channel.')
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    // 44px to tap: the hit area grows past the 24px switch
    expect(toggle).toHaveClass('after:-inset-y-2.5')
  })

  it('shows its body only while on', () => {
    renderCard(false)
    expect(screen.queryByText('Zipline settings')).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Clips' })).not.toHaveAttribute('aria-controls')
  })

  it('shows its body while on, controlled by the switch', () => {
    const onChange = renderCard(true)

    expect(screen.getByText('Zipline settings')).toBeInTheDocument()
    const toggle = screen.getByRole('switch', { name: 'Clips' })
    expect(toggle).toHaveAttribute('aria-controls', 'card-clips-body')

    fireEvent.click(toggle)
    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('always shows the body of a card with no switch', () => {
    render(
      <SettingCard id="card-rules" icon={Tv} title="House rules">
        <p>Rules</p>
      </SettingCard>
    )

    expect(screen.getByText('Rules')).toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })
})

describe('card heading levels', () => {
  function card() {
    return (
      <SettingCard id="card-login" icon={Tv} title="Username and password">
        <Subsection title="Guest login" />
      </SettingCard>
    )
  }

  it('are h2 and h3 under a wizard step, as its h1 wants', () => {
    render(card())
    expect(screen.getByRole('heading', { level: 2, name: 'Username and password' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Guest login' })).toBeInTheDocument()
  })

  it('are h3 and h4 under a section heading of their own', () => {
    render(<CardHeadingLevel value={3}>{card()}</CardHeadingLevel>)
    expect(screen.getByRole('heading', { level: 3, name: 'Username and password' })).toHaveClass('font-sans', 'font-semibold')
    expect(screen.getByRole('heading', { level: 4, name: 'Guest login' })).toHaveClass('font-sans', 'font-semibold')
  })
})

describe('ToggleRow', () => {
  it('names and describes its switch', () => {
    const onChange = vi.fn()
    render(
      <ToggleRow
        id="setup-userChannelSelection"
        icon={Tv}
        title="Anyone can change the live channel"
        description="Clearing it stays admin-only."
        checked={false}
        onChange={onChange}
      />
    )

    const toggle = screen.getByRole('switch', { name: 'Anyone can change the live channel' })
    expect(toggle).toHaveAttribute('id', 'setup-userChannelSelection')
    expect(toggle).toHaveAccessibleDescription('Clearing it stays admin-only.')
    fireEvent.click(toggle)
    expect(onChange).toHaveBeenCalledWith(true)
  })
})

describe('PasswordRules', () => {
  it('ticks each rule as it is met, in words as well as colour', () => {
    const { rerender } = render(<PasswordRules password="short" confirm="" />)

    const list = screen.getByRole('list', { name: 'Password rules' })
    expect(list).toHaveTextContent('At least 12 characters, not met yet')
    expect(list).toHaveTextContent('Both passwords match, not met yet')

    rerender(<PasswordRules password="long enough phrase" confirm="long enough phrase" />)

    expect(list).toHaveTextContent('At least 12 characters, met')
    expect(list).toHaveTextContent('Both passwords match, met')
    expect(screen.getAllByRole('listitem').every((item) => item.classList.contains('text-success'))).toBe(true)
  })

  it('does not call two empty passwords a match', () => {
    render(<PasswordRules password="" confirm="" />)

    expect(screen.getByRole('list', { name: 'Password rules' })).toHaveTextContent('Both passwords match, not met yet')
  })
})

describe('small pieces', () => {
  it('Callout can be an alert', () => {
    render(<Callout tone="danger" role="alert">Turn on a source.</Callout>)

    expect(screen.getByRole('alert')).toHaveTextContent('Turn on a source.')
  })

  it('NativeSelect is a native select', () => {
    render(
      <NativeSelect aria-label="Log level" value="INFO" onChange={vi.fn()}>
        <option>DEBUG</option>
        <option>INFO</option>
      </NativeSelect>
    )

    expect(screen.getByRole('combobox', { name: 'Log level' })).toHaveValue('INFO')
  })
})
