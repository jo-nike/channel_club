import { useState } from 'react'
import { Palette, Check } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTheme } from '@/hooks/useTheme'
import { getThemeCategories, getTheme } from '@/lib/themes'
import type { ThemeId } from '@/types/theme'
import { cn } from '@/lib/utils'

/**
 * ThemePicker component - displays a popover with all available themes
 * organized by light/dark categories with color preview swatches
 */
export function ThemePicker() {
  const [open, setOpen] = useState(false)
  const { themeId, setTheme } = useTheme()
  const categories = getThemeCategories()

  const handleThemeSelect = (id: ThemeId) => {
    setTheme(id)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              className="h-8 w-8 flex items-center justify-center bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              aria-label="Choose theme"
            >
              <Palette className="h-4 w-4 shrink-0" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          <p>Choose theme</p>
        </TooltipContent>
      </Tooltip>
      <PopoverContent className="w-64 p-2" align="end">
        <div className="space-y-3">
          {categories.map((category) => (
            <div key={category.mode}>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-2 mb-1">
                {category.label}
              </h3>
              <div className="space-y-0.5">
                {category.themes.map((theme) => (
                  <ThemeOption
                    key={theme.id}
                    id={theme.id}
                    name={theme.name}
                    isSelected={themeId === theme.id}
                    onSelect={handleThemeSelect}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

interface ThemeOptionProps {
  id: ThemeId
  name: string
  isSelected: boolean
  onSelect: (id: ThemeId) => void
}

function ThemeOption({ id, name, isSelected, onSelect }: ThemeOptionProps) {
  const theme = getTheme(id)

  // Extract the oklch values for preview swatches
  const bgColor = theme.colors.background
  const primaryColor = theme.colors.primary
  const accentColor = theme.colors.accent

  return (
    <button
      onClick={() => onSelect(id)}
      className={cn(
        'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left',
        'hover:bg-accent hover:text-accent-foreground',
        'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
        isSelected && 'bg-accent'
      )}
      aria-pressed={isSelected}
    >
      {/* Color swatches preview */}
      <div className="flex gap-0.5 shrink-0">
        <div
          className="w-3 h-3 rounded-sm border border-border"
          style={{ backgroundColor: bgColor }}
          aria-hidden="true"
        />
        <div
          className="w-3 h-3 rounded-sm border border-border"
          style={{ backgroundColor: primaryColor }}
          aria-hidden="true"
        />
        <div
          className="w-3 h-3 rounded-sm border border-border"
          style={{ backgroundColor: accentColor }}
          aria-hidden="true"
        />
      </div>

      {/* Theme name */}
      <span className="flex-1 truncate">{name}</span>

      {/* Selected indicator */}
      {isSelected && (
        <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      )}
    </button>
  )
}
