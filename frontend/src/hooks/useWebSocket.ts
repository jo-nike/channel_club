import { useEffect, useRef, useCallback, useState } from 'react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/authStore'
import { useChannelStore } from '@/stores/channelStore'
import { useTVStore } from '@/stores/tvStore'
import { useUIStore } from '@/stores/uiStore'
import { useChatStore } from '@/stores/chatStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { logger } from '@/lib/logger'
import { getSessionId } from '@/lib/sessionId'
import { useChatEnabled } from './useChatEnabled'
import type { AppSettings, Channel, ChatMessage } from '@/types'

interface WebSocketMessage {
  type: string
  channel?: Channel | null
  // Username of whoever changed the live channel (channel_update); absent from older servers
  changedBy?: string | null
  currentChannel?: Channel | null
  settings?: AppSettings
  // Chat message fields
  clientMessageId?: string
  accepted?: boolean
  messageId?: string
  username?: string
  content?: string
  timestamp?: string
  messages?: ChatMessage[]
}

export type WebSocketStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

const PING_INTERVAL = 30000
const MAX_RETRIES = 5
const INITIAL_BACKOFF = 1000 // 1 second
const MAX_BACKOFF = 10000 // 10 seconds
// After the fast retries run out, keep trying slowly; jitter spreads clients out after a server restart
const SLOW_RETRY_INTERVAL = 30000 // 30 seconds
const SLOW_RETRY_JITTER = 5000 // up to 5 seconds

// One fixed id, so rapid live-channel switches replace the toast instead of stacking
const LIVE_CHANGE_TOAST_ID = 'live-channel-change'
const LIVE_CHANGE_TOAST_DURATION = 5000

/**
 * Tell the viewer someone changed the live channel (channel 0), naming who.
 * Skipped for the person who made the change and for viewers already on
 * channel 0, who see the change happen in the player.
 */
function notifyLiveChange(channel: Channel | null, changedBy: string | null) {
  if (changedBy && changedBy === useAuthStore.getState().username) return
  if (useTVStore.getState().selectedChannel?.type === 'live') return

  if (channel) {
    toast(changedBy ? `${changedBy} put on ${channel.name}` : `Live channel set to ${channel.name}`, {
      id: LIVE_CHANGE_TOAST_ID,
      duration: LIVE_CHANGE_TOAST_DURATION,
      action: {
        label: 'Watch',
        onClick: () => {
          const tv = useTVStore.getState()
          tv.selectChannel(tv.getUnifiedChannels()[0])
        },
      },
    })
  } else if (changedBy) {
    // Sonner merges an update into a visible toast with the same id, so an
    // omitted action would keep the previous 'put on' toast's Watch button.
    toast(`${changedBy} stopped live TV`, {
      id: LIVE_CHANGE_TOAST_ID,
      duration: LIVE_CHANGE_TOAST_DURATION,
      action: undefined,
    })
  }
}

interface UseWebSocketOptions {
  view?: 'live' | 'ersatztv' | 'tv'
}

export type ChatSendResult = 'acknowledged' | 'not-sent' | 'unconfirmed'

interface UseWebSocketReturn {
  status: WebSocketStatus
  reconnect: () => void
  sendChannelUpdate: (channelName: string | null, programmeTitle?: string | null, viewType?: 'live' | 'ersatztv', channelId?: string | null) => void
  sendChatMessage: (content: string) => Promise<ChatSendResult>
  sendSetNickname: (nickname: string) => void
}

export function useWebSocket(options: UseWebSocketOptions = {}): UseWebSocketReturn {
  const { view = 'live' } = options
  const token = useAuthStore((s) => s.token)
  const setCurrentChannel = useChannelStore((s) => s.setCurrentChannel)
  const setLastChange = useChannelStore((s) => s.setLastChange)
  const notificationsEnabled = useUIStore((s) => s.notificationsEnabled)
  const chatEnabled = useChatEnabled()
  const addChatMessage = useChatStore((s) => s.addMessage)
  const setChatMessages = useChatStore((s) => s.setMessages)
  const setUserChannelSelection = useSettingsStore((s) => s.setUserChannelSelection)

  const pendingChat = useRef(new Map<string, { finish: (result: ChatSendResult) => void; timer: ReturnType<typeof setTimeout> }>())
  const clearPendingChat = useCallback(() => {
    pendingChat.current.forEach(({ finish, timer }) => { clearTimeout(timer); finish('unconfirmed') })
    pendingChat.current.clear()
  }, [])
  const wsRef = useRef<WebSocket | null>(null)
  const pingIntervalRef = useRef<number | null>(null)
  const reconnectTimeoutRef = useRef<number | null>(null)
  const retryCountRef = useRef(0)
  // Tracked per socket instance - a shared flag would be reset by a new connect()
  // before the previous socket's close event arrives
  const intentionalClosesRef = useRef(new WeakSet<WebSocket>())
  const connectRef = useRef<((isReconnect?: boolean) => void) | null>(null)
  const notificationsEnabledRef = useRef(notificationsEnabled)

  // Keep notificationsEnabledRef in sync with state to avoid stale closure
  useEffect(() => {
    notificationsEnabledRef.current = notificationsEnabled
  }, [notificationsEnabled])

  const [status, setStatus] = useState<WebSocketStatus>('disconnected')

  const getBackoffDelay = useCallback(() => {
    return Math.min(INITIAL_BACKOFF * Math.pow(2, retryCountRef.current), MAX_BACKOFF)
  }, [])

  const clearTimers = useCallback(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current)
      pingIntervalRef.current = null
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
  }, [])

  const handleMessage = useCallback(
    (message: WebSocketMessage) => {
      switch (message.type) {
        case 'connection_ack':
          logger.debug('WebSocket', 'Received connection_ack', message)
          setCurrentChannel(message.currentChannel ?? null)
          if (message.settings) {
            setUserChannelSelection(message.settings.userChannelSelection)
          }
          break

        case 'settings_update':
          logger.debug('WebSocket', 'Received settings_update', message)
          if (message.settings) {
            setUserChannelSelection(message.settings.userChannelSelection)
          }
          break

        case 'channel_update': {
          logger.debug('WebSocket', `Channel update: ${message.channel?.name || 'null'}`)
          // A null channel means the channel was cleared - propagate it too
          const channel = message.channel ?? null
          const changedBy = message.changedBy ?? null
          setCurrentChannel(channel)
          setLastChange({ by: changedBy, at: Date.now(), channelName: channel?.name ?? null })
          if (notificationsEnabledRef.current) {
            notifyLiveChange(channel, changedBy)
          }
          break
        }

        case 'pong':
          // Ping acknowledged, connection healthy
          logger.debug('WebSocket', 'Received pong')
          break

        case 'chat_message':
          if (chatEnabled && message.messageId && message.username && message.content && message.timestamp) {
            logger.debug('WebSocket', `Chat message from ${message.username}`)
            addChatMessage({
              messageId: message.messageId,
              username: message.username,
              content: message.content,
              timestamp: message.timestamp,
            })
          }
          break

        case 'chat_history':
          if (chatEnabled && message.messages) {
            logger.debug('WebSocket', `Received chat history: ${message.messages.length} messages`)
            setChatMessages(message.messages)
          }
          break

        default:
          // Unknown message type - log but don't crash
          logger.warn('WebSocket', `Unknown message type: ${message.type}`, message)
      }
    },
    [setCurrentChannel, setLastChange, chatEnabled, addChatMessage, setChatMessages, setUserChannelSelection]
  )

  const connect = useCallback(
    (isReconnect = false) => {
      if (!token) return

      clearPendingChat()
      // Close existing connection if any (a CONNECTING socket would otherwise be orphaned)
      const existing = wsRef.current
      if (existing && existing.readyState !== WebSocket.CLOSED) {
        intentionalClosesRef.current.add(existing)
        existing.close()
      }
      // Drop the old socket's ping interval and any pending reconnect
      clearTimers()

      logger.info('WebSocket', isReconnect ? 'Reconnecting...' : 'Connecting...')
      setStatus(isReconnect ? 'reconnecting' : 'connecting')

      // Construct WebSocket URL with view and session parameters
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const sessionId = getSessionId()
      const wsUrl = `${wsProtocol}//${window.location.host}/api/ws?token=${token}&view=${view}&session_id=${sessionId}`

      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        // Ignore a socket that has already been superseded by a newer one
        if (wsRef.current !== ws) return

        logger.info('WebSocket', 'Connected successfully')
        setStatus('connected')
        retryCountRef.current = 0

        // Send nickname if set (for chat display name)
        const currentNickname = useChatStore.getState().nickname
        if (currentNickname) {
          ws.send(JSON.stringify({ type: 'set_nickname', nickname: currentNickname }))
          logger.debug('WebSocket', `Sent nickname on connect: ${currentNickname}`)
        }

        // Start ping interval for keep-alive
        pingIntervalRef.current = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }))
          }
        }, PING_INTERVAL)
      }

      ws.onmessage = (event) => {
        // Ignore a socket that has already been superseded by a newer one
        if (wsRef.current !== ws) return

        try {
          const message: WebSocketMessage = JSON.parse(event.data)
          if (message.type === 'chat_ack' && message.clientMessageId) {
            const pending = pendingChat.current.get(message.clientMessageId)
            if (pending) {
              pendingChat.current.delete(message.clientMessageId)
              clearTimeout(pending.timer)
              pending.finish(message.accepted && message.messageId ? 'acknowledged' : 'not-sent')
            }
          } else handleMessage(message)
        } catch (e) {
          // Log but don't crash on invalid JSON
          logger.error('WebSocket', 'Failed to parse message', {
            data: event.data,
            error: e,
          })
        }
      }

      ws.onerror = (error) => {
        logger.error('WebSocket', 'Connection error', error)
      }

      ws.onclose = (event) => {
        // Don't reconnect if intentionally closed (logout, or replaced by a new connection)
        if (intentionalClosesRef.current.has(ws)) {
          logger.info('WebSocket', 'Disconnected (intentional)')
          if (wsRef.current === ws) {
            clearTimers()
            wsRef.current = null
            setStatus('disconnected')
          }
          return
        }

        // Ignore a socket that has already been superseded by a newer one
        if (wsRef.current !== ws) {
          logger.debug('WebSocket', `Ignoring close from stale socket (code: ${event.code})`)
          return
        }

        clearTimers()
        clearPendingChat()
        wsRef.current = null

        // Token expired - don't reconnect, log out and redirect to login
        if (event.code === 4001) {
          logger.info('WebSocket', 'Disconnected (token expired)')
          setStatus('disconnected')
          useAuthStore.getState().logout()
          return
        }

        logger.info('WebSocket', `Disconnected (code: ${event.code})`)

        // Attempt reconnection if we haven't exceeded retries
        if (retryCountRef.current < MAX_RETRIES) {
          const delay = getBackoffDelay()
          logger.debug(
            'WebSocket',
            `Scheduling reconnect in ${delay}ms (attempt ${retryCountRef.current + 1}/${MAX_RETRIES})`
          )
          setStatus('reconnecting')

          reconnectTimeoutRef.current = window.setTimeout(() => {
            retryCountRef.current++
            connectRef.current?.(true)
          }, delay)
        } else {
          // Never give up: a restart longer than the fast retries must not strand the tab
          const delay = SLOW_RETRY_INTERVAL + Math.random() * SLOW_RETRY_JITTER
          logger.warn('WebSocket', `Fast reconnection attempts exhausted, retrying in ${Math.round(delay)}ms`)
          setStatus('disconnected')

          reconnectTimeoutRef.current = window.setTimeout(() => {
            connectRef.current?.(true)
          }, delay)
        }
      }
    },
    [token, view, handleMessage, clearTimers, clearPendingChat, getBackoffDelay]
  )

  // Keep connectRef in sync with connect function
  useEffect(() => {
    connectRef.current = connect
  }, [connect])

  const disconnect = useCallback(() => {
    clearTimers()
    clearPendingChat()
    const ws = wsRef.current
    if (ws) {
      intentionalClosesRef.current.add(ws)
      ws.close()
      wsRef.current = null
    }
    setStatus('disconnected')
  }, [clearTimers, clearPendingChat])

  const reconnect = useCallback(() => {
    retryCountRef.current = 0
    if (!token || useAuthStore.getState().token !== token) return
    connect(true)
  }, [connect, token])

  useEffect(() => {
    const recover = () => {
      if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) reconnect()
    }
    const onVisible = () => { if (document.visibilityState === 'visible') recover() }
    window.addEventListener('online', recover)
    // Foreground tabs and TVs never fire online or visibilitychange, but they do regain focus
    window.addEventListener('focus', recover)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', recover)
      window.removeEventListener('focus', recover)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [reconnect])

  const sendChannelUpdate = useCallback(
    (channelName: string | null, programmeTitle?: string | null, viewType?: 'live' | 'ersatztv', channelId?: string | null) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'channel_update',
            channel: channelName,
            channelId: channelId ?? null,
            programme: programmeTitle ?? null,
            view: viewType ?? null,
          })
        )
        logger.debug('WebSocket', `Sent channel update: ${channelName || 'null'} - ${programmeTitle || 'null'} (view: ${viewType || 'unchanged'})`)
      }
    },
    []
  )

  const sendChatMessage = useCallback(
    (content: string): Promise<ChatSendResult> => {
      const socket = wsRef.current
      if (!chatEnabled || socket?.readyState !== WebSocket.OPEN || pendingChat.current.size >= 20) return Promise.resolve('not-sent')
      // getRandomValues also works on the supported HTTP LAN development origin.
      const clientMessageId = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('')
      return new Promise((finish) => {
        const timer = setTimeout(() => {
          pendingChat.current.delete(clientMessageId)
          finish('unconfirmed')
        }, 10_000)
        pendingChat.current.set(clientMessageId, { finish, timer })
        try {
          socket.send(JSON.stringify({ type: 'chat_message', content, clientMessageId }))
        } catch {
          clearTimeout(timer)
          pendingChat.current.delete(clientMessageId)
          finish('not-sent')
        }
      })
    },
    [chatEnabled]
  )

  const sendSetNickname = useCallback((nicknameValue: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'set_nickname',
          nickname: nicknameValue,
        })
      )
      logger.debug('WebSocket', `Sent set_nickname: ${nicknameValue}`)
    }
  }, [])

  // Connect on mount when token is available
  // Intentionally calls connect (which sets state) in effect - this is the standard WebSocket pattern
  useEffect(() => {
    if (token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      connect()
    }
    return () => disconnect()
  }, [token, connect, disconnect])

  return { status, reconnect, sendChannelUpdate, sendChatMessage, sendSetNickname }
}
