import { useEffect } from 'react'
import { fetchAppSettings } from '@/services/api'
import { useSettingsStore } from '@/stores/settingsStore'

/**
 * Hook for the admin-controlled runtime settings.
 *
 * The WebSocket connection_ack carries the settings and settings_update keeps
 * them fresh, so this mount fetch is only a fallback for when the socket is
 * unavailable.
 */
export function useAppSettings() {
  const userChannelSelection = useSettingsStore((s) => s.userChannelSelection)
  const setUserChannelSelection = useSettingsStore((s) => s.setUserChannelSelection)

  useEffect(() => {
    let mounted = true

    async function loadSettings() {
      try {
        const settings = await fetchAppSettings()
        if (mounted) {
          setUserChannelSelection(settings.userChannelSelection)
        }
      } catch {
        // Leave the current value alone - the WebSocket is the primary source
      }
    }

    loadSettings()

    return () => {
      mounted = false
    }
  }, [setUserChannelSelection])

  return { userChannelSelection }
}
