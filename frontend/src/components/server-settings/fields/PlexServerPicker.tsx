import { useNow } from '@/hooks/useNow'
import type { PlexServer } from '@/types/setup'
import { Chip } from './Chip'

function plural(n: number, one: string): string {
  return `${n} ${one}${n === 1 ? '' : 's'}`
}

/** "last seen 3 days ago", or '' when the time won't read. */
function lastSeen(iso: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000)
  if (Number.isNaN(minutes)) return ''
  if (minutes < 1) return 'last seen just now'
  if (minutes < 60) return `last seen ${plural(minutes, 'minute')} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `last seen ${plural(hours, 'hour')} ago`
  return `last seen ${plural(Math.floor(hours / 24), 'day')} ago`
}

function serverMeta(server: PlexServer, now: number): string {
  const parts: string[] = []
  const members = server.memberCount
  if (members != null) {
    parts.push(members === 0 ? 'Not shared yet' : `Shared with ${members} ${members === 1 ? 'person' : 'people'}`)
  }
  if (!server.online && server.lastSeenAt) {
    const seen = lastSeen(server.lastSeenAt, now)
    if (seen) parts.push(seen)
  }
  const meta = parts.join(' · ')
  return meta.charAt(0).toUpperCase() + meta.slice(1)
}

interface PlexServerPickerProps {
  servers: readonly PlexServer[]
  /** The chosen server's machine id */
  value: string | null
  onChange: (machineId: string) => void
  name: string
  /** The id of the text that names the list */
  labelledBy: string
}

/** The Plex servers a Plex account owns, one to pick: native radios on rows. */
export function PlexServerPicker({ servers, value, onChange, name, labelledBy }: PlexServerPickerProps) {
  // "last seen" moves on while the list is open
  const now = useNow(60_000)

  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="flex flex-col overflow-hidden rounded-xl border bg-card">
      {servers.map((server) => {
        const meta = serverMeta(server, now)
        return (
          <label
            key={server.machineId}
            className="flex min-h-14 cursor-pointer items-center gap-3 border-t px-3.5 py-2.5 first:border-t-0 has-checked:bg-primary/10"
          >
            <input
              type="radio"
              name={name}
              value={server.machineId}
              checked={value === server.machineId}
              onChange={() => onChange(server.machineId)}
              className="m-0 size-[18px] shrink-0 accent-primary"
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-semibold [overflow-wrap:anywhere]">{server.name}</span>
              {meta && <span className="text-[13px] text-muted-foreground">{meta}</span>}
            </span>
            <Chip tone={server.online ? 'ok' : 'muted'}>{server.online ? 'Online' : 'Offline'}</Chip>
          </label>
        )
      })}
    </div>
  )
}
