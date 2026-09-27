import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { createPortal } from "react-dom"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { usePlayerFullscreenElement } from "@/hooks/useFullscreenState"

// Toasts sit top-center, below the notch, leaving the bottom-right corner to
// the install banner
const TOP_OFFSET = { top: "calc(16px + env(safe-area-inset-top, 0px))" }

// While the player is fullscreen only it is drawn, so the toasts (reminders,
// live changes) move inside it. Moving remounts the toaster: a toast already
// up at that moment isn't carried over, later ones show.
export function Toaster({ ...props }: ToasterProps) {
  const fullscreenPlayer = usePlayerFullscreenElement()
  const toaster = (
    <Sonner
      theme="dark"
      className="toaster group"
      position="top-center"
      offset={TOP_OFFSET}
      mobileOffset={TOP_OFFSET}
      // Sonner draws action buttons 24px tall; min-height outgrows that to a
      // 44px target on touch screens, mouse desktops keep the compact button
      toastOptions={{ classNames: { actionButton: "pointer-coarse:min-h-11" } }}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
          // Sonner's own CSS sets a system font stack on the toaster; the
          // inline style wins, and the titles inherit the app's UI face
          fontFamily: "var(--font-sans)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
  return fullscreenPlayer ? createPortal(toaster, fullscreenPlayer) : toaster
}
