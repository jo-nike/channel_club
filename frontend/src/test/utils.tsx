import { ReactElement } from 'react'
import { render, RenderOptions } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'

/**
 * Custom render function that wraps components with necessary providers
 */
function customRender(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  return render(ui, {
    wrapper: ({ children }) => (
      <TooltipProvider delayDuration={0}>{children}</TooltipProvider>
    ),
    ...options,
  })
}

// Re-export everything from @testing-library/react
export * from '@testing-library/react'

// Override the render export with our custom render
export { customRender as render }
