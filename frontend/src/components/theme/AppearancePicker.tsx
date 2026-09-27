import { useId } from 'react'
import { Moon, Sun, SunMoon, type LucideIcon } from 'lucide-react'
import { ThemeTile } from '@/components/theme/ThemeTile'
import { useThemeStore } from '@/stores/themeStore'
import { getThemeCategories } from '@/lib/themes'
import type { ThemeCategory, ThemeId, ThemeMode } from '@/types/theme'

type Appearance = 'auto' | ThemeMode

const APPEARANCES: { value: Appearance; label: string; icon: LucideIcon }[] = [
  { value: 'auto', label: 'Auto', icon: SunMoon },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'light', label: 'Light', icon: Sun },
]

const HINTS: Record<Appearance, string> = {
  auto: 'Matches your device. Pick one dark and one light theme.',
  dark: 'Always use a dark theme.',
  light: 'Always use a light theme.',
}

/** In Auto, when each group's pick is used */
const AUTO_WHEN: Record<ThemeMode, string> = {
  dark: 'When your device is in dark mode',
  light: 'When your device is in light mode',
}

/**
 * Auto/Dark/Light, then the themes as preview tiles grouped by mode. Dark
 * and Light show that group; Auto shows both, with one pick checked in each.
 */
export function AppearancePicker() {
  const followSystem = useThemeStore((s) => s.followSystem)
  const mode = useThemeStore((s) => s.mode)
  const darkThemeId = useThemeStore((s) => s.darkThemeId)
  const lightThemeId = useThemeStore((s) => s.lightThemeId)
  const setTheme = useThemeStore((s) => s.setTheme)
  const setFollowSystem = useThemeStore((s) => s.setFollowSystem)
  const setMode = useThemeStore((s) => s.setMode)

  const appearance: Appearance = followSystem ? 'auto' : mode
  const categories = getThemeCategories().filter((category) => followSystem || category.mode === mode)

  function choose(value: Appearance) {
    if (value === 'auto') setFollowSystem(true)
    else setMode(value)
  }

  // Each group checks its pick; outside Auto only the group on screen shows
  function isSelected(category: ThemeCategory, id: ThemeId) {
    return id === (category.mode === 'dark' ? darkThemeId : lightThemeId)
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div role="group" aria-label="Appearance" className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
          {APPEARANCES.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              aria-pressed={appearance === value}
              onClick={() => choose(value)}
              className="inline-flex h-11 items-center justify-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm pointer-fine:md:h-9"
            >
              <Icon className="size-4" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">{HINTS[appearance]}</p>
      </div>
      {categories.map((category) => (
        <ThemeGroup
          key={category.mode}
          category={category}
          description={followSystem ? AUTO_WHEN[category.mode] : undefined}
          isSelected={(id) => isSelected(category, id)}
          onSelect={setTheme}
        />
      ))}
    </div>
  )
}

interface ThemeGroupProps {
  category: ThemeCategory
  description?: string
  isSelected: (id: ThemeId) => boolean
  onSelect: (id: ThemeId) => void
}

function ThemeGroup({ category, description, isSelected, onSelect }: ThemeGroupProps) {
  const headingId = useId()

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <div>
        <h3 id={headingId} className="text-sm uppercase tracking-wide text-muted-foreground">
          {category.mode === 'dark' ? 'Dark' : 'Light'}
        </h3>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-3">
        {category.themes.map((theme) => (
          <ThemeTile key={theme.id} theme={theme} selected={isSelected(theme.id)} onSelect={onSelect} />
        ))}
      </div>
    </section>
  )
}
