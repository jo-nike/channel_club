import type { CSSProperties } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Theme, ThemeId } from '@/types/theme'

interface ThemeTileProps {
  theme: Theme
  selected: boolean
  onSelect: (id: ThemeId) => void
}

/** Paint a preview block in one of the theme's own colours */
const fill = (color: string): CSSProperties => ({ backgroundColor: color })

/**
 * A theme as a small picture of the app in its colours: the header, a guide
 * row with the programme on now, and a chat bubble, over its background.
 * The name and a check sit below, so the choice never rests on colour alone.
 */
export function ThemeTile({ theme, selected, onSelect }: ThemeTileProps) {
  const { colors } = theme

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(theme.id)}
      className={cn(
        'flex flex-col overflow-hidden rounded-xl border bg-card text-left text-card-foreground transition-colors hover:border-primary/60',
        selected ? 'border-primary ring-2 ring-primary' : 'border-border'
      )}
    >
      <span
        aria-hidden="true"
        data-slot="theme-preview"
        className="flex h-[84px] w-full flex-col gap-1.5 p-2"
        style={fill(colors.background)}
      >
        {/* Header: logo dot, title and a LIVE badge */}
        <span className="flex h-3 shrink-0 items-center gap-1 rounded-sm px-1" style={fill(colors.card)}>
          <span className="size-1.5 rounded-full" style={fill(colors.primary)} />
          <span className="h-1 w-6 rounded-full" style={fill(colors.cardForeground)} />
          <span className="ml-auto h-1.5 w-3 rounded-sm" style={fill(colors.live)} />
        </span>
        {/* Guide row: channel, the programme on now, the one after */}
        <span className="flex h-5 shrink-0 gap-1">
          <span className="w-4 rounded-sm" style={fill(colors.muted)} />
          <span className="flex flex-[3] items-center rounded-sm px-1" style={fill(colors.guideNow)}>
            <span className="h-1 w-3/4 rounded-full" style={fill(colors.foreground)} />
          </span>
          <span className="flex flex-[2] items-center rounded-sm px-1" style={fill(colors.guideFuture)}>
            <span className="h-1 w-1/2 rounded-full" style={fill(colors.mutedForeground)} />
          </span>
        </span>
        {/* Chat: an avatar and a bubble */}
        <span className="mt-auto flex items-end gap-1">
          <span className="size-3 shrink-0 rounded-full" style={fill(colors.primary)} />
          <span
            className="flex h-4 w-3/5 flex-col justify-center gap-0.5 rounded-md rounded-bl-none px-1"
            style={fill(colors.secondary)}
          >
            <span className="h-0.5 w-full rounded-full" style={fill(colors.secondaryForeground)} />
            <span className="h-0.5 w-2/3 rounded-full" style={fill(colors.secondaryForeground)} />
          </span>
        </span>
      </span>
      <span className="flex min-h-9 items-center justify-between gap-1 px-2.5 py-2 text-sm font-medium">
        <span className="truncate">{theme.name}</span>
        {selected && <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />}
      </span>
    </button>
  )
}
