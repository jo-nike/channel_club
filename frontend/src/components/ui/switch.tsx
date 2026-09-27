import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * An on/off switch: a native button with role="switch" and aria-checked, so
 * Space and Enter toggle it and screen readers announce "on"/"off". Name it
 * with aria-label or aria-labelledby. Hand-rolled to avoid adding
 * @radix-ui/react-switch for one control; the API mirrors shadcn's Switch.
 */
function Switch({
  checked,
  onCheckedChange,
  className,
  onClick,
  ...props
}: Omit<React.ComponentProps<"button">, "role" | "aria-checked" | "value"> & {
  checked: boolean
  onCheckedChange?: (checked: boolean) => void
}) {
  const state = checked ? "checked" : "unchecked"

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-slot="switch"
      data-state={state}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) onCheckedChange?.(!checked)
      }}
      className={cn(
        "inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 shadow-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
        className
      )}
      {...props}
    >
      <span
        data-slot="switch-thumb"
        data-state={state}
        className="pointer-events-none block size-5 rounded-full bg-background shadow-sm transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0 dark:data-[state=checked]:bg-primary-foreground dark:data-[state=unchecked]:bg-foreground"
      />
    </button>
  )
}

export { Switch }
