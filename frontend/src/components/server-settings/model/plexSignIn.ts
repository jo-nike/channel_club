import type { PlexAccount, PlexServer } from '@/types/setup'

/**
 * Plex as a form holds it to link a server: who signed in, the servers they
 * own and the one picked. The token stays in memory: it is never stored.
 */
export interface PlexSignIn {
  token: string | null
  account: PlexAccount | null
  servers: readonly PlexServer[]
  machineId: string | null
}

export const EMPTY_PLEX: PlexSignIn = { token: null, account: null, servers: [], machineId: null }

/** The first online server, or the first one. */
function defaultServer(servers: readonly PlexServer[]): string | null {
  return (servers.find((server) => server.online) ?? servers[0])?.machineId ?? null
}

/** Signed in, or the servers listed again: the one picked stays picked while it's still listed. */
export function plexSignedIn(
  plex: PlexSignIn,
  token: string,
  account: PlexAccount,
  servers: readonly PlexServer[]
): PlexSignIn {
  const kept = plex.machineId !== null && servers.some((server) => server.machineId === plex.machineId)
  return { token, account, servers, machineId: kept ? plex.machineId : defaultServer(servers) }
}
