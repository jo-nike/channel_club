import { useEffect, useState } from 'react'
import { APP_NAME, APP_VERSION } from '@/lib/appInfo'
import { healthCheck, type ApplicationHealth } from '@/services/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

/** App metadata remains available even when the upstream status request fails. */
export function ApplicationStatus() {
  const [health, setHealth] = useState<ApplicationHealth | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    async function refresh() {
      try {
        const result = await healthCheck(controller.signal)
        if (!controller.signal.aborted) {
          setHealth(result)
          setState('ready')
        }
      } catch {
        if (!controller.signal.aborted) {
          setHealth(null)
          setState('error')
        }
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(refresh, 30_000)
      }
    }
    void refresh()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [attempt])

  return (
    <Card className="m-4 mb-0">
      <CardHeader><CardTitle>{APP_NAME}</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-2">
          <dt className="text-muted-foreground">Frontend version</dt><dd>v{APP_VERSION}</dd>
          <dt className="text-muted-foreground">Backend version</dt>
          <dd>{health ? `v${health.version}` : state === 'loading' ? 'Loading…' : 'Unavailable'}</dd>
          <dt className="text-muted-foreground">Build ID</dt><dd className="break-all">{health?.buildId ?? 'Unavailable'}</dd>
          <dt className="text-muted-foreground">Source revision</dt><dd className="break-all">{health?.revision ?? 'Unavailable'}</dd>
        </dl>
        {health && health.version !== APP_VERSION && (
          <p role="alert" className="text-amber-600 dark:text-amber-400">
            Frontend and backend versions differ. Reload to get the current application.
          </p>
        )}
        {state === 'error' && <div className="flex flex-wrap items-center gap-3">
          <p role="status">Application information is unavailable.</p>
          <Button variant="outline" size="sm" onClick={() => { setState('loading'); setAttempt(n => n + 1) }}>Retry application info</Button>
        </div>}
      </CardContent>
    </Card>
  )
}
