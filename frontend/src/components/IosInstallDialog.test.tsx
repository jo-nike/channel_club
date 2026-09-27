import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@/test/utils'
import { IosInstallDialog } from './IosInstallDialog'

describe('IosInstallDialog', () => {
  it('renders nothing while closed', () => {
    render(<IosInstallDialog open={false} onOpenChange={vi.fn()} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('walks through Share, then Add to Home Screen, in order', () => {
    render(<IosInstallDialog open onOpenChange={vi.fn()} />)

    const dialog = screen.getByRole('dialog', { name: 'Add Channel Club to your Home Screen' })
    const steps = within(dialog).getAllByRole('listitem')
    expect(steps).toHaveLength(2)
    expect(steps[0]).toHaveTextContent('Tap Share in the browser toolbar.')
    expect(steps[1]).toHaveTextContent('Then tap Add to Home Screen.')
    // Each step shows the icon to look for
    expect(steps[0].querySelector('svg')).not.toBeNull()
    expect(steps[1].querySelector('svg')).not.toBeNull()
  })

  it('has only the close X, which closes it', () => {
    const onOpenChange = vi.fn()
    render(<IosInstallDialog open onOpenChange={onOpenChange} />)

    const buttons = within(screen.getByRole('dialog')).getAllByRole('button')
    expect(buttons).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
