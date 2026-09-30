import { StrictMode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { expect } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
import { SetupWizard } from '@/components/setup/SetupWizard'
import type { WizardProps } from '@/components/setup/useSetupWizard'
import type { TokenResponse } from '@/services/api'

/** A session token as the server signs one (the signature isn't checked here). */
export function sessionToken(claims: Record<string, unknown>): string {
  return `header.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, ...claims }))}.signature`
}

/** The claim's answer for a session with these claims. */
export function session(claims: Record<string, unknown>): TokenResponse {
  return { accessToken: sessionToken(claims), tokenType: 'bearer', role: 'admin' }
}

/** A promise the test settles when it wants. */
export function pending<T>() {
  let settle: (value: T) => void = () => {}
  const promise = new Promise<T>((resolve) => {
    settle = resolve
  })
  return { promise, settle }
}

/**
 * A step's heading once it has focus. The wizard focuses it in an effect after
 * the step renders, and after an answer from the server that can come a moment
 * after the heading shows, so this waits for the focus too.
 */
export async function focusedStepHeading(name: string): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { level: 1, name })
  await waitFor(() => expect(heading).toHaveFocus())
  return heading
}

/**
 * The wizard at /setup with the toaster SetupRoute gives it, and a home page
 * (with its own toaster) to leave for. `strict` puts StrictMode at the root,
 * as main.tsx does: only there does it run each effect twice.
 */
export function renderWizard(props: Partial<WizardProps> = {}, { strict = false } = {}) {
  const router = createMemoryRouter(
    [
      {
        path: '/setup',
        element: (
          <>
            <SetupWizard setupState="unclaimed" envLocked={[]} admin={null} {...props} />
            <Toaster />
          </>
        ),
      },
      {
        path: '/',
        element: (
          <>
            <p>Home page</p>
            <Toaster />
          </>
        ),
      },
    ],
    { initialEntries: ['/setup'] }
  )
  const app = <RouterProvider router={router} />
  render(strict ? <StrictMode>{app}</StrictMode> : app)
  return router
}
