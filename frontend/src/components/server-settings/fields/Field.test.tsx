import { describe, it, expect } from 'vitest'
import { render, screen } from '@/test/utils'
import { Field } from './Field'

function renderField(props: Partial<Parameters<typeof Field>[0]> = {}) {
  return render(
    <Field id="setup-dispatcharrUrl" label="Address" {...props}>
      {(control) => <input {...control} />}
    </Field>
  )
}

describe('Field', () => {
  it('labels its control and describes it by nothing when there is nothing to say', () => {
    renderField()

    const input = screen.getByLabelText('Address')
    expect(input).toHaveAttribute('id', 'setup-dispatcharrUrl')
    expect(input).not.toHaveAttribute('aria-describedby')
    expect(input).not.toHaveAttribute('aria-invalid')
  })

  it('describes the control by its help, warning and error, in that order', () => {
    renderField({ help: 'Phones play from here.', warning: 'Use https.', error: 'Enter the full address.' })

    const input = screen.getByLabelText('Address')
    expect(input).toHaveAttribute(
      'aria-describedby',
      'setup-dispatcharrUrl-help setup-dispatcharrUrl-warn setup-dispatcharrUrl-err'
    )
    expect(input).toHaveAccessibleDescription('Phones play from here. Use https. Enter the full address.')
    expect(input).toHaveAttribute('aria-invalid', 'true')
  })

  it('says which variables lock it instead of the help, and drops the warning', () => {
    renderField({ help: 'Phones play from here.', warning: 'Use https.', lockedBy: ['DISPATCHARR_URL', 'DISPATCHARR_API_KEY'] })

    const input = screen.getByLabelText('Address')
    expect(input).toHaveAttribute('aria-describedby', 'setup-dispatcharrUrl-env')
    expect(input).toHaveAccessibleDescription("Set by DISPATCHARR_URL and DISPATCHARR_API_KEY in the server's environment.")
    expect(screen.queryByText('Phones play from here.')).not.toBeInTheDocument()
    expect(screen.queryByText('Use https.')).not.toBeInTheDocument()
  })

  it('lists three variables with commas and "and"', () => {
    renderField({ lockedBy: ['A', 'B', 'C'] })

    expect(screen.getByLabelText('Address')).toHaveAccessibleDescription("Set by A, B and C in the server's environment.")
  })

  it('marks an optional setting and keeps a label-row action', () => {
    renderField({ optional: true, labelAside: <button type="button">New name</button> })

    expect(screen.getByLabelText('Address optional')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New name' })).toBeInTheDocument()
  })
})
