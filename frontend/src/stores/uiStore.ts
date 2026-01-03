import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface UIState {
  isTheaterMode: boolean
  setTheaterMode: (value: boolean) => void
  toggleTheaterMode: () => void
  isSidebarOpen: boolean
  setSidebarOpen: (value: boolean) => void
  toggleSidebar: () => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      isTheaterMode: false,
      setTheaterMode: (value) => set({ isTheaterMode: value }),
      toggleTheaterMode: () => set((s) => ({ isTheaterMode: !s.isTheaterMode })),
      isSidebarOpen: false,
      setSidebarOpen: (value) => set({ isSidebarOpen: value }),
      toggleSidebar: () => set((s) => ({ isSidebarOpen: !s.isSidebarOpen })),
    }),
{
      name: 'ui-storage',
      partialize: (state) => ({ isSidebarOpen: state.isSidebarOpen }),
    }
  )
)
