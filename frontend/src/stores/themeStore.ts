import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ThemeId } from '@/types/theme'
import { DEFAULT_THEME_ID } from '@/lib/themes'

interface ThemeState {
  themeId: ThemeId
  setTheme: (themeId: ThemeId) => void
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      themeId: DEFAULT_THEME_ID,
      setTheme: (themeId) => set({ themeId }),
    }),
    {
      name: 'theme-storage',
    }
  )
)
