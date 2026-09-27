import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { focusOverrides } from '@/test/focus'
import { Switch } from './switch'

function LabelledSwitch({ initial = false }: { initial?: boolean }) {
  const [checked, setChecked] = useState(initial)
  return (
    <div>
      <span id="label">Users can set the live channel</span>
      <Switch aria-labelledby="label" checked={checked} onCheckedChange={setChecked} />
    </div>
  )
}

describe('Switch', () => {
  it('is a native button exposed as a switch, named by its label', () => {
    render(<LabelledSwitch />)

    const toggle = screen.getByRole('switch', { name: 'Users can set the live channel' })
    // A native button gets Space/Enter activation and focusability for free
    expect(toggle.tagName).toBe('BUTTON')
    expect(toggle).toHaveAttribute('type', 'button')
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(toggle).toHaveAttribute('data-state', 'unchecked')
  })

  it('turns on and off when pressed', () => {
    render(<LabelledSwitch />)
    const toggle = screen.getByRole('switch')

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    expect(toggle).toHaveAttribute('data-state', 'checked')

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'false')
  })

  it('is controlled: it reports the next value and shows whatever checked says', () => {
    const onCheckedChange = vi.fn()
    render(<Switch aria-label="Setting" checked onCheckedChange={onCheckedChange} />)
    const toggle = screen.getByRole('switch', { name: 'Setting' })

    fireEvent.click(toggle)

    expect(onCheckedChange).toHaveBeenCalledWith(false)
    expect(toggle).toHaveAttribute('aria-checked', 'true')
  })

  it('does nothing while disabled', () => {
    const onCheckedChange = vi.fn()
    render(<Switch aria-label="Setting" checked={false} onCheckedChange={onCheckedChange} disabled />)

    const toggle = screen.getByRole('switch', { name: 'Setting' })
    fireEvent.click(toggle)

    expect(toggle).toBeDisabled()
    expect(onCheckedChange).not.toHaveBeenCalled()
  })

  it('lets an onClick handler cancel the change', () => {
    const onCheckedChange = vi.fn()
    render(
      <Switch
        aria-label="Setting"
        checked={false}
        onCheckedChange={onCheckedChange}
        onClick={(event) => event.preventDefault()}
      />
    )

    fireEvent.click(screen.getByRole('switch', { name: 'Setting' }))

    expect(onCheckedChange).not.toHaveBeenCalled()
  })

  it('relies on the global focus outline, with no ring or :focus styles of its own', () => {
    render(<Switch aria-label="Setting" checked={false} />)

    const toggle = screen.getByRole('switch', { name: 'Setting' })
    expect(focusOverrides(toggle)).toEqual([])
    expect(toggle.className).not.toMatch(/(^|\s)focus:/)
  })
})
