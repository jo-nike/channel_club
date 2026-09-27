export interface AuthState {
  token: string | null
  role: 'admin' | 'viewer' | null
  isAuthenticated: boolean
}

export interface LoginRequest {
  username: string
  password: string
}

export interface TokenResponse {
  accessToken: string
  tokenType: string
  role: 'admin' | 'viewer'
}

export interface Channel {
  id: string
  name: string
  streamUrl: string
  guideId: string
}

export interface ChannelGroupWithChannels {
  id: number
  name: string
  channelCount: number
  channels: Channel[]
}

export interface GroupedChannelsResponse {
  groups: ChannelGroupWithChannels[]
  ungrouped: Channel[]
}

export interface User {
  username: string
  role: 'admin' | 'viewer'
}

export interface Program {
  title: string
  startTime: string // ISO 8601
  endTime: string // ISO 8601
  description?: string
}

export interface EPGResponse {
  channelId: string
  currentProgram: Program | null
  nextProgram?: Program | null
}

/** Current programme per channel, keyed by Channel.guideId. */
export interface NowPlayingBulkResponse {
  nowPlaying: Record<string, Program>
}

/** Runtime settings an admin can toggle for all users. */
export interface AppSettings {
  userChannelSelection: boolean
}

// ErsatzTV types
export interface ErsatzTVChannel {
  id: string
  name: string
  streamUrl: string // Original stream URL (not used directly)
  logoUrl: string // Proxied logo URL
  number: number
  group: string
}

export interface ErsatzTVProgramme {
  id: string
  channelId: string
  title: string
  description?: string
  start: string // ISO 8601
  stop: string // ISO 8601
  category?: string[]
  season?: number
  episode?: number
  year?: string
}

export interface ErsatzTVChannelsResponse {
  channels: ErsatzTVChannel[]
}

export interface ErsatzTVCurrentResponse {
  channelId: string
  current: ErsatzTVProgramme | null
  nextUp: ErsatzTVProgramme | null
}

export interface ErsatzTVProgrammesResponse {
  channelId: string
  programmes: ErsatzTVProgramme[]
}

// Unified TV types (for consolidated TV view)
export interface UnifiedChannel {
  id: string
  name: string
  number: number // 0 for Live, 1+ for ErsatzTV
  streamUrl: string
  type: 'live' | 'ersatztv'
  logoUrl?: string
  group?: string
  guideId?: string // For live channel EPG lookup
  backendId?: string // Actual backend channel ID (for highlight recording)
}

// Chat types
export interface ChatMessage {
  messageId: string
  // Display name at the time of sending (the nickname, or the sign-in name)
  username: string
  // Stable, opaque id of the sender's account; unlike username it survives a rename.
  // Absent from older servers
  userId?: string
  content: string
  timestamp: string // ISO8601
}
