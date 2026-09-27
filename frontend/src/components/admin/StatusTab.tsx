import { useSystemStatus, type SystemStatusData } from '@/hooks/useSystemStatus'
import { ApplicationStatus } from './ApplicationStatus'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { RefreshCw, CheckCircle, XCircle, Activity, Tv, Clock, Wifi, Zap, Monitor, CalendarClock, TriangleAlert } from 'lucide-react'

function formatLastUpdated(date: Date | null): string {
  if (!date) return ''
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  return `${Math.floor(seconds / 60)}m ago`
}

function formatLastChecked(isoDate: string): string {
  const date = new Date(isoDate)
  return date.toLocaleTimeString()
}

function formatTimestamp(isoDate: string | null, fallback: string): string {
  if (!isoDate) return fallback
  return new Date(isoDate).toLocaleString()
}

function guideDataState(status: SystemStatusData['epg']): 'Online' | 'Stale' | 'Unavailable' {
  if (!status.online) return 'Unavailable'
  return status.stale ? 'Stale' : 'Online'
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`
  const hours = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  return `${hours}h ${mins}m`
}

function formatBufferSeconds(seconds: number | null | undefined): string {
  if (seconds == null) return 'N/A'
  if (seconds < 0) return 'behind'
  return `${seconds.toFixed(1)}s ahead`
}

export function StatusTab() {
  return <><ApplicationStatus /><ServiceStatus /></>
}

function ServiceStatus() {
  const { data, loading, error, lastUpdated, isRefreshing, refetch } = useSystemStatus()

  if (loading) {
    return <StatusTabSkeleton />
  }

  if (error) {
    return (
      <div className="p-4 text-center text-destructive">
        Failed to load system status: {error}
      </div>
    )
  }

  if (!data) {
    return null
  }

  return (
    <div className="space-y-6 p-4">
      {/* Header with refresh */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">System Status</h2>
          <p className="text-sm text-muted-foreground">
            External service health monitoring
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {formatLastUpdated(lastUpdated)}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={refetch}
            disabled={isRefreshing}
            aria-label="Refresh system status"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Status cards */}
      <div className="grid gap-4 md:grid-cols-2">
        <ErsatzTVCard status={data.ersatztv} />
        <DispatchrrCard status={data.dispatcharr} />
        <GuideDataCard status={data.epg} />
      </div>
    </div>
  )
}

interface ErsatzTVCardProps {
  status: SystemStatusData['ersatztv']
}

function ErsatzTVCard({ status }: ErsatzTVCardProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Tv className="h-5 w-5" />
            ErsatzTV
          </CardTitle>
          <StatusIndicator online={status.online} />
        </div>
        <CardDescription>
          {status.online ? 'Transcoding service' : status.error || 'Service unavailable'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <StatusRow
          icon={<Activity className="h-4 w-4 text-muted-foreground" />}
          label="Status"
          value={status.online ? 'Online' : 'Offline'}
        />
        {status.online && (
          <StatusRow
            icon={<Tv className="h-4 w-4 text-muted-foreground" />}
            label="Active Sessions"
            value={status.activeSessions.toString()}
          />
        )}
        <StatusRow
          label="Last Checked"
          value={formatLastChecked(status.lastChecked)}
        />
        {status.sessions.length > 0 && (
          <div className="pt-3 border-t space-y-3">
            <p className="text-xs font-medium text-muted-foreground">
              Active Sessions
            </p>
            {status.sessions.map((session) => (
              <div
                key={session.channelNumber}
                className="rounded-md bg-muted/50 p-3 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">
                    #{session.channelNumber} {session.channelName || ''}
                  </span>
                  {session.state && (
                    <span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary">
                      {session.state}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  {session.bufferSeconds != null && (
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Zap className="h-3 w-3" />
                      <span>Buffer: {formatBufferSeconds(session.bufferSeconds)}</span>
                    </div>
                  )}
                  {session.videoBitrate != null && (
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Wifi className="h-3 w-3" />
                      <span>{session.videoBitrate >= 1000 ? `${(session.videoBitrate / 1000).toFixed(1)} Mbps` : `${session.videoBitrate} kbps`}</span>
                    </div>
                  )}
                  {session.resolution && (
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Monitor className="h-3 w-3" />
                      <span>{session.resolution}</span>
                    </div>
                  )}
                  {session.videoCodec && (
                    <div className="text-muted-foreground">
                      {session.videoCodec.toUpperCase()}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

interface DispatchrrCardProps {
  status: SystemStatusData['dispatcharr']
}

function DispatchrrCard({ status }: DispatchrrCardProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Dispatcharr
          </CardTitle>
          <StatusIndicator online={status.online} />
        </div>
        <CardDescription>
          {status.online ? 'Stream proxy service' : status.error || 'Service unavailable'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <StatusRow
          icon={<Activity className="h-4 w-4 text-muted-foreground" />}
          label="Status"
          value={status.online ? 'Online' : 'Offline'}
        />
        {status.online && (
          <StatusRow
            icon={<Tv className="h-4 w-4 text-muted-foreground" />}
            label="Active Streams"
            value={status.activeStreams.toString()}
          />
        )}
        <StatusRow
          label="Last Checked"
          value={formatLastChecked(status.lastChecked)}
        />
        {status.streams && status.streams.length > 0 && (
          <div className="pt-3 border-t space-y-3">
            <p className="text-xs font-medium text-muted-foreground">
              Active Streams
            </p>
            {status.streams.map((stream) => (
              <div
                key={stream.channelId}
                className="rounded-md bg-muted/50 p-3 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{stream.streamName}</span>
                  <span className="text-xs text-muted-foreground">
                    {stream.clientCount} viewer{stream.clientCount !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span>Uptime: {formatUptime(stream.uptime)}</span>
                  </div>
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <Wifi className="h-3 w-3" />
                    <span>{stream.avgBitrate || 'N/A'}</span>
                  </div>
                  {stream.resolution && (
                    <div className="text-muted-foreground">
                      {stream.resolution} @ {stream.sourceFps?.toFixed(0) || '?'}fps
                    </div>
                  )}
                  {stream.videoCodec && (
                    <div className="text-muted-foreground">
                      {stream.videoCodec.toUpperCase()}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

interface GuideDataCardProps {
  status: SystemStatusData['epg']
}

function GuideDataCard({ status }: GuideDataCardProps) {
  const state = guideDataState(status)
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5" />
            Guide data (XMLTV)
          </CardTitle>
          {state === 'Stale' ? (
            <div className="flex items-center gap-1 text-amber-600">
              <TriangleAlert className="h-5 w-5" />
            </div>
          ) : (
            <StatusIndicator online={status.online} />
          )}
        </div>
        <CardDescription>Programme guide feed from Dispatcharr</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <StatusRow
          icon={<Activity className="h-4 w-4 text-muted-foreground" />}
          label="Status"
          value={state}
        />
        {status.error && <StatusRow label="Last Error" value={status.error} />}
        <StatusRow label="Channels" value={status.channelCount.toString()} />
        <StatusRow label="Programmes" value={status.programmeCount.toString()} />
        <StatusRow label="Last Success" value={formatTimestamp(status.lastSuccessAt, 'Never')} />
        {status.nextRetryAt && (
          <StatusRow label="Next Retry" value={formatTimestamp(status.nextRetryAt, '')} />
        )}
      </CardContent>
    </Card>
  )
}

interface StatusIndicatorProps {
  online: boolean
}

function StatusIndicator({ online }: StatusIndicatorProps) {
  return online ? (
    <div className="flex items-center gap-1 text-green-600">
      <CheckCircle className="h-5 w-5" />
    </div>
  ) : (
    <div className="flex items-center gap-1 text-red-600">
      <XCircle className="h-5 w-5" />
    </div>
  )
}

interface StatusRowProps {
  icon?: React.ReactNode
  label: string
  value: string
}

function StatusRow({ icon, label, value }: StatusRowProps) {
  return (
    <div className="flex items-center justify-between text-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <span className="font-medium">{value}</span>
    </div>
  )
}

function StatusTabSkeleton() {
  return (
    <div className="space-y-6 p-4">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-8 w-8" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    </div>
  )
}
