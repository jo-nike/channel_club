import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog'

describe('DialogContent close button', () => {
  it('keeps the 16px X but grows its hit area to 44px on touch screens', () => {
    render(
      <Dialog defaultOpen>
        <DialogContent>
          <DialogTitle>Appearance</DialogTitle>
          <DialogDescription>Choose a look</DialogDescription>
        </DialogContent>
      </Dialog>
    )
    const close = screen.getByRole('button', { name: 'Close' })
    expect(close).toHaveClass(
      'pointer-coarse:grid',
      'pointer-coarse:size-11',
      'pointer-coarse:place-items-center',
      'pointer-coarse:top-2',
      'pointer-coarse:right-2',
    )
    // The mouse layout is unchanged
    expect(close).toHaveClass('top-4', 'right-4', "[&_svg:not([class*='size-'])]:size-4")
  })
})
