import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ThemeId, ThemeMode } from '@/types/theme'
import { DEFAULT_THEME_ID, getTheme } from '@/lib/themes'

/** The light theme a device starts with, used in Auto and in Light mode */
export const DEFAULT_LIGHT_THEME_ID: ThemeId = 'club-day'

export interface ThemeState {
  // Auto: show darkThemeId or lightThemeId to match the device's colour scheme
  followSystem: boolean
  // Dark or light while not following the system
  mode: ThemeMode
  darkThemeId: ThemeId
  lightThemeId: ThemeId
  /**
   * Pick a theme. It fills the dark or light slot that matches its mode;
   * outside Auto it also becomes the theme on screen.
   */
  setTheme: (themeId: ThemeId) => void
  setFollowSystem: (value: boolean) => void
  /** Show the dark or light pick, and stop following the system */
  setMode: (mode: ThemeMode) => void
}

type ThemeChoice = Pick<ThemeState, 'followSystem' | 'mode' | 'darkThemeId' | 'lightThemeId'>

/** The theme on screen outside Auto: the pick for the chosen mode */
export function activeThemeId(state: ThemeChoice): ThemeId {
  return state.mode === 'dark' ? state.darkThemeId : state.lightThemeId
}

/** v0 saved a single themeId; v1 keeps it in the slot for its mode */
function fromThemeId(themeId: unknown): ThemeChoice {
  const theme = getTheme(themeId as ThemeId)
  return {
    followSystem: false,
    mode: theme.mode,
    darkThemeId: theme.mode === 'dark' ? theme.id : DEFAULT_THEME_ID,
    lightThemeId: theme.mode === 'light' ? theme.id : DEFAULT_LIGHT_THEME_ID,
  }
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      followSystem: false,
      mode: 'dark',
      darkThemeId: DEFAULT_THEME_ID,
      lightThemeId: DEFAULT_LIGHT_THEME_ID,
      setTheme: (themeId) => {
        const { mode } = getTheme(themeId)
        set((s) => ({
          ...(mode === 'dark' ? { darkThemeId: themeId } : { lightThemeId: themeId }),
          ...(s.followSystem ? {} : { mode }),
        }))
      },
      setFollowSystem: (value) => set({ followSystem: value }),
      setMode: (mode) => set({ followSystem: false, mode }),
    }),
    {
      name: 'theme-storage',
      version: 1,
      // Chained: one `if (fromVersion < n)` guard per version, in order
      migrate: (persistedState, fromVersion) => {
        let state = { ...(persistedState as Record<string, unknown>) }
        if (fromVersion < 1) {
          // v1: dark and light picks plus Auto. The saved theme stays on
          // screen: Auto starts off and the theme fills its mode's slot.
          state = { ...fromThemeId(state.themeId) }
        }
        return state as unknown as ThemeState
      },
      partialize: (state) => ({
        followSystem: state.followSystem,
        mode: state.mode,
        darkThemeId: state.darkThemeId,
        lightThemeId: state.lightThemeId,
      }),
    }
  )
)
