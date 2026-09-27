import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from './dialog'
import { Popover, PopoverContent, PopoverTrigger } from './popover'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from './dropdown-menu'

function openMenu() {
  fireEvent.keyDown(screen.getByRole('button', { name: 'Account' }), {
    key: 'Enter',
  })
}

describe('DropdownMenu', () => {
  it('opens from the keyboard and highlights the first item', () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Account</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Signed in</DropdownMenuLabel>
          <DropdownMenuItem>Profile</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem>Sign out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    openMenu()

    expect(screen.getByRole('menu')).toBeInTheDocument()
    const first = screen.getByRole('menuitem', { name: 'Profile' })
    expect(first).toHaveFocus()
    expect(first).toHaveAttribute('data-highlighted')
    expect(screen.getByRole('separator')).toBeInTheDocument()
  })

  it('styles items on data-highlighted, never on :focus', () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Account</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Profile</DropdownMenuItem>
          <DropdownMenuCheckboxItem checked>Chat</DropdownMenuCheckboxItem>
          <DropdownMenuRadioGroup value="a">
            <DropdownMenuRadioItem value="a">A</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    )
    openMenu()

    const items = [
      screen.getByRole('menuitem', { name: 'Profile' }),
      screen.getByRole('menuitemcheckbox', { name: 'Chat' }),
      screen.getByRole('menuitemradio', { name: 'A' }),
    ]
    for (const item of items) {
      expect(item.className).toContain('data-[highlighted]:bg-accent')
      expect(item.className).not.toMatch(/(^|\s)focus:/)
    }
  })

  it('runs onSelect and closes when an item is chosen', () => {
    const onSelect = vi.fn()
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Account</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={onSelect}>Sign out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
    openMenu()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }))

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('reports checkbox and radio changes', () => {
    const onCheckedChange = vi.fn()
    const onValueChange = vi.fn()
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Account</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuCheckboxItem
            checked={false}
            onCheckedChange={onCheckedChange}
          >
            Show chat
          </DropdownMenuCheckboxItem>
          <DropdownMenuRadioGroup value="auto" onValueChange={onValueChange}>
            <DropdownMenuRadioItem value="auto">Auto</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    )
    openMenu()

    expect(
      screen.getByRole('menuitemradio', { name: 'Auto' })
    ).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Show chat' }))
    expect(onCheckedChange).toHaveBeenCalledWith(true)

    openMenu()
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Dark' }))
    expect(onValueChange).toHaveBeenCalledWith('dark')
  })

  it('portals the content into the given container (fullscreen support)', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Account</DropdownMenuTrigger>
        <DropdownMenuContent container={container}>
          <DropdownMenuItem>Profile</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
    openMenu()

    expect(container).toContainElement(screen.getByRole('menu'))
    container.remove()
  })

  // Radix keeps its focus-trap and dismissable-layer stacks in module state,
  // so these only pass while the menu shares one copy of those packages with
  // Dialog and Popover (see npm ls @radix-ui/react-focus-scope).
  describe('alongside Dialog and Popover', () => {
    function AccountMenu() {
      return (
        <DropdownMenu>
          <DropdownMenuTrigger>Account</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Profile</DropdownMenuItem>
            <DropdownMenuItem>Sign out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
    }

    it('opens a dialog from an item and restores the page after it closes', async () => {
      function MenuWithDialog() {
        const [open, setOpen] = useState(false)
        return (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger>Account</DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => setOpen(true)}>
                  Send feedback
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogContent>
                <DialogTitle>Feedback</DialogTitle>
                <DialogDescription>Tell us what happened</DialogDescription>
              </DialogContent>
            </Dialog>
          </>
        )
      }
      render(<MenuWithDialog />)
      openMenu()

      fireEvent.keyDown(
        screen.getByRole('menuitem', { name: 'Send feedback' }),
        { key: 'Enter' }
      )
      const dialog = await screen.findByRole('dialog')
      await waitFor(() => expect(dialog).toContainElement(
        document.activeElement as HTMLElement
      ))
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()

      fireEvent.keyDown(document.activeElement ?? document.body, {
        key: 'Escape',
      })
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      )
      expect(document.body.style.pointerEvents).not.toBe('none')
    })

    it('moves focus to the first item when opened inside a dialog', async () => {
      render(
        <Dialog defaultOpen>
          <DialogContent>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>Account settings</DialogDescription>
            <AccountMenu />
          </DialogContent>
        </Dialog>
      )
      openMenu()

      await waitFor(() =>
        expect(screen.getByRole('menuitem', { name: 'Profile' })).toHaveFocus()
      )
    })

    it('closes only the menu on Escape inside a popover', async () => {
      render(
        <Popover defaultOpen>
          <PopoverTrigger>More</PopoverTrigger>
          <PopoverContent>
            <AccountMenu />
          </PopoverContent>
        </Popover>
      )
      openMenu()
      await waitFor(() =>
        expect(screen.getByRole('menuitem', { name: 'Profile' })).toHaveFocus()
      )

      fireEvent.keyDown(document.activeElement ?? document.body, {
        key: 'Escape',
      })

      await waitFor(() =>
        expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      )
      expect(
        screen.getByRole('button', { name: 'Account' })
      ).toBeInTheDocument()
    })
  })
})
