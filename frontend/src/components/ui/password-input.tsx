import * as React from "react"
import { Eye, EyeOff } from "lucide-react"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

interface PasswordInputProps extends Omit<React.ComponentProps<"input">, "type"> {
  /** What it holds, for the reveal button's name "Show {noun}" (default "password") */
  noun?: string
}

/**
 * An Input for a password or key, with a button that shows what was typed.
 * The button keeps one name, "Show {noun}", and aria-pressed says whether the
 * value is shown, like the app's other toggles. It is 38px inside the 44px
 * input (h-11 unless className sets a height).
 */
function PasswordInput({ noun = "password", className, disabled, ...props }: PasswordInputProps) {
  const [shown, setShown] = React.useState(false)
  const Icon = shown ? EyeOff : Eye

  return (
    <div data-slot="password-input" className="relative flex items-center">
      <Input
        {...props}
        type={shown ? "text" : "password"}
        disabled={disabled}
        className={cn("h-11 pr-12", className)}
      />
      <button
        type="button"
        aria-label={`Show ${noun}`}
        aria-pressed={shown}
        disabled={disabled}
        onClick={() => setShown((value) => !value)}
        className="absolute top-1/2 right-[3px] grid size-[38px] -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
      >
        <Icon className="size-[18px]" aria-hidden="true" />
      </button>
    </div>
  )
}

export { PasswordInput }
