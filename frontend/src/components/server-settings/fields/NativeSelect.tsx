import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/**
 * A native select styled like Input. Native, not a custom listbox: it gets the
 * platform's picker on phones and TVs and the global focus outline.
 */
export function NativeSelect({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        'h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base shadow-xs disabled:cursor-not-allowed disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground aria-invalid:border-destructive',
        className
      )}
      {...props}
    >
      {children}
    </select>
  )
}
