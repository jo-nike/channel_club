import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@/test/utils'
import { NumberField } from './NumberField'

describe('NumberField', () => {
  it('is a numeric text input with its unit, sending what is typed', () => {
    const onChange = vi.fn()
    render(<NumberField id="setup-mediaExportMaxBytes" label="Largest export" value="256" unit="MB" onChange={onChange} />)

    const input = screen.getByLabelText('Largest export')
    expect(input).toHaveValue('256')
    expect(input).toHaveAttribute('inputmode', 'numeric')
    expect(screen.getByText('MB')).toBeInTheDocument()

    fireEvent.change(input, { target: { value: '512' } })
    expect(onChange).toHaveBeenCalledWith('512')
  })

  it('says when it differs from the default', () => {
    render(<NumberField id="x" label="Casts at once" value="9" changed onChange={vi.fn()} />)

    expect(screen.getByLabelText('Casts at once · changed')).toBeInTheDocument()
  })

  it('ties its error to the input', () => {
    render(<NumberField id="x" label="Segments in the playlist" value="1" error="Use a whole number from 2 to 30." onChange={vi.fn()} />)

    const input = screen.getByLabelText('Segments in the playlist')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('Use a whole number from 2 to 30.')
  })

  it('is read-only and says why when the environment sets it', () => {
    render(<NumberField id="x" label="Casts at once" value="8" lockedBy={['MEDIA_PROCESS_LIMIT']} onChange={vi.fn()} />)

    const input = screen.getByLabelText('Casts at once')
    expect(input).toHaveAttribute('readonly')
    expect(input).toHaveAccessibleDescription("Set by MEDIA_PROCESS_LIMIT in the server's environment.")
  })
})
