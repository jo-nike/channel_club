import type { AppSettings, Channel, PresenceEntry } from '@/types'

/**
 * The messages the server sends over /api/ws, one interface per type.
 *
 * Written by hand to mirror the server's models (backend/app/models/websocket.py);
 * the committed schema backend/tests/snapshots/ws_server_messages.schema.json
 * changes with them, and its test says to update this file.
 */

// A chat message as sent in chat_message and chat_history
export interface ChatLine {
  messageId: string
  username: string
  userId: string
  content: string
  timestamp: string
  kind: 'user' | 'system' | 'share' | 'suggestion'
  channelId: string | null
  channelName: string | null
  programme: string | null
  view: 'live' | 'ersatztv' | null
}

// Which optional features the server has on
export interface ServerFeatures {
  chat: boolean
  gif: boolean
}

export interface ConnectionAckMessage {
  type: 'connection_ack'
  currentChannel: Channel | null
  settings: AppSettings
  // Who this socket is signed in as
  you: { username: string; userId: string }
  // Who is here
  presence: PresenceEntry[]
  // The server's build
  buildId: string
  // Absent from older servers (a rollback): features then show as the build says
  features?: ServerFeatures
}

export interface ChatHistoryMessage {
  type: 'chat_history'
  messages: ChatLine[]
}

export interface ChatMessageMessage extends ChatLine {
  type: 'chat_message'
}

export interface ChatAckMessage {
  type: 'chat_ack'
  clientMessageId: string
  accepted: boolean
  // Only on an accepted send
  messageId?: string
}

export interface ChannelUpdateMessage {
  type: 'channel_update'
  // Null when Live was cleared
  channel: Channel | null
  // Username of whoever changed the live channel; null for system changes
  changedBy: string | null
}

export interface SettingsUpdateMessage {
  type: 'settings_update'
  settings: AppSettings
}

// An optional feature switched on or off: chat and GIFs come as in
// connection_ack; clips, casting and feedback are read again from their
// /feature endpoints
export interface FeaturesUpdateMessage {
  type: 'features_update'
  features: ServerFeatures
}

export interface PresenceUpdateMessage {
  type: 'presence_update'
  presence: PresenceEntry[]
}

export interface PongMessage {
  type: 'pong'
}

export interface ErrorMessage {
  type: 'error'
  code: 'invalid_message' | 'rate_limited' | 'nickname_taken'
  // On rate_limited and nickname_taken for a nickname change: the nickname as sent
  nickname?: string
  // On invalid_message for a chat send: the refused send's id
  clientMessageId?: string
}

export type ServerMessage =
  | ConnectionAckMessage
  | ChatHistoryMessage
  | ChatMessageMessage
  | ChatAckMessage
  | ChannelUpdateMessage
  | SettingsUpdateMessage
  | FeaturesUpdateMessage
  | PresenceUpdateMessage
  | PongMessage
  | ErrorMessage
