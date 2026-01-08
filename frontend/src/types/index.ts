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
