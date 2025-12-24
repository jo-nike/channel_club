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
}

export interface User {
  username: string
  role: 'admin' | 'viewer'
}
