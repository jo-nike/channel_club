import { useState, useEffect } from 'react'
import { getHighlightFeatureEnabled } from '@/services/api'

/**
 * Hook to check if the highlight capture feature is enabled on the server.
 * Fetches the feature flag once on mount.
 */
export function useHighlightFeature() {
  const [isEnabled, setIsEnabled] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    async function checkFeature() {
      try {
        const enabled = await getHighlightFeatureEnabled()
        if (mounted) {
          setIsEnabled(enabled)
        }
      } catch {
        // Feature disabled if we can't reach the endpoint
        if (mounted) {
          setIsEnabled(false)
        }
      } finally {
        if (mounted) {
          setIsLoading(false)
        }
      }
    }

    checkFeature()

    return () => {
      mounted = false
    }
  }, [])

  return { isEnabled, isLoading }
}
