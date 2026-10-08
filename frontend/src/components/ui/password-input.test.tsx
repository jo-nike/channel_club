import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@/test/utils'
import { focusOverrides } from '@/test/focus'
import { PasswordInput } from './password-input'

describe('PasswordInput', () => {
  it('hides the value behind a Show password toggle, not pressed', () => {
    render(<PasswordInput aria-label="Password" defaultValue="hunter" />)

    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')
    const toggle = screen.getByRole('button', { name: 'Show password' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(toggle).toHaveAttribute('type', 'button')
  })

  it('shows the value while pressed, keeping its name, and hides it again', () => {
    const { container } = render(<PasswordInput aria-label="Password" defaultValue="hunter" />)
    const toggle = screen.getByRole('button', { name: 'Show password' })

    fireEvent.click(toggle)

    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text')
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(toggle).toHaveAccessibleName('Show password')
    expect(container.querySelector('.lucide-eye-off')).toBeInTheDocument()

    fireEvent.click(toggle)

    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(container.querySelector('.lucide-eye')).toBeInTheDocument()
  })

  it('names the toggle after what it holds', () => {
    render(<PasswordInput aria-label="API key" noun="API key" />)

    expect(screen.getByRole('button', { name: 'Show API key' })).toBeInTheDocument()
  })

  it('passes attributes and handlers to the input and adds className to its own', () => {
    const onChange = vi.fn()
    render(
      <PasswordInput
        id="dispatcharr-key"
        aria-label="API key"
        aria-describedby="key-help"
        autoComplete="off"
        data-1p-ignore=""
        value=""
        onChange={onChange}
        className="font-mono"
      />
    )
    const input = screen.getByLabelText('API key')

    fireEvent.change(input, { target: { value: 'abc' } })

    expect(onChange).toHaveBeenCalled()
    expect(input).toHaveAttribute('id', 'dispatcharr-key')
    expect(input).toHaveAttribute('aria-describedby', 'key-help')
    expect(input).toHaveAttribute('autocomplete', 'off')
    expect(input).toHaveAttribute('data-1p-ignore')
    // Room for the 38px toggle inside a 44px input
    expect(input).toHaveClass('h-11', 'pr-12', 'font-mono')
  })

  it('lets className set another height', () => {
    render(<PasswordInput aria-label="Password" className="h-14" />)

    expect(screen.getByLabelText('Password')).toHaveClass('h-14')
    expect(screen.getByLabelText('Password')).not.toHaveClass('h-11')
  })

  it('disables the toggle with the input', () => {
    render(<PasswordInput aria-label="Password" disabled />)

    expect(screen.getByLabelText('Password')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Show password' })).toBeDisabled()
  })

  it('does not submit the form around it', () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <PasswordInput aria-label="Password" />
      </form>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Show password' }))

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('leaves focus to the global outline', () => {
    render(<PasswordInput aria-label="Password" />)

    expect(focusOverrides(screen.getByLabelText('Password'))).toEqual([])
    expect(focusOverrides(screen.getByRole('button', { name: 'Show password' }))).toEqual([])
  })
})
