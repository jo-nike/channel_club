import { useEffect, useRef, useCallback, useState } from 'react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/authStore'
import { useChannelStore, describeLiveChange } from '@/stores/channelStore'
import { useTVStore } from '@/stores/tvStore'
import { useUIStore } from '@/stores/uiStore'
import { useChatStore } from '@/stores/chatStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { usePresenceStore } from '@/stores/presenceStore'
import { logger } from '@/lib/logger'
import { getSessionId } from '@/lib/sessionId'
import { createClientMessageId } from '@/lib/messageId'
import { noticeServerBuild } from '@/lib/appUpdate'
import { useChatEnabled } from './useChatEnabled'
import { refreshAuth } from './useAuth'
import type { AppSettings, Channel, ChatMessage, PresenceEntry } from '@/types'

interface WebSocketMessage {
  type: string
  channel?: Channel | null
  // Username of whoever changed the live channel (channel_update); absent from older servers
  changedBy?: string | null
  currentChannel?: Channel | null
  settings?: AppSettings
  // Who this socket is signed in as (connection_ack); absent from older servers
  you?: { username: string; userId?: string }
  // Who is here (connection_ack and presence_update); absent from older servers
  presence?: PresenceEntry[]
  // The server's build (connection_ack); absent from older servers
  buildId?: string
  // Chat message fields
  clientMessageId?: string
  accepted?: boolean
  messageId?: string
  username?: string
  userId?: string
  content?: string
  timestamp?: string
  kind?: ChatMessage['kind']
  channelId?: ChatMessage['channelId']
  channelName?: ChatMessage['channelName']
  programme?: ChatMessage['programme']
  view?: ChatMessage['view']
  messages?: ChatMessage[]
  // error: what went wrong, and for nickname_taken the refused nickname
  code?: string
  nickname?: string
}

// restarting: the server closed with 1012 (Service Restart, a deploy); lasts until the next connection_ack
export type WebSocketStatus = 'connecting' | 'connected' | 'reconnecting' | 'restarting' | 'disconnected'

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
    toast(describeLiveChange(channel.name, changedBy), {
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
    toast(describeLiveChange(null, changedBy), {
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
  sendChannelUpdate: (channelName: string | null, programmeTitle?: string | null, viewType?: 'live' | 'ersatztv', channelId?: string | null, onLive?: boolean) => void
  sendChatMessage: (content: string, clientMessageId?: string) => Promise<ChatSendResult>
  // Post a card of what this viewer is watching; the server fills in the channel
  sendShare: (clientMessageId?: string) => Promise<ChatSendResult>
  // Suggest a channel for live TV in chat; the server looks the channel up by id
  sendSuggest: (channelId: string, clientMessageId?: string) => Promise<ChatSendResult>
  sendSetNickname: (nickname: string) => void
}

export function useWebSocket(options: UseWebSocketOptions = {}): UseWebSocketReturn {
  const { view = 'live' } = options
  // A sign-in or sign-out starts a new generation and a new socket; a
  // refreshed token keeps both and is sent over the open socket instead
  const generation = useAuthStore((s) => s.generation)
  const signedIn = useAuthStore((s) => s.token !== null)
  const token = useAuthStore((s) => s.token)
  const setCurrentChannel = useChannelStore((s) => s.setCurrentChannel)
  const setLastChange = useChannelStore((s) => s.setLastChange)
  const notificationsEnabled = useUIStore((s) => s.notificationsEnabled)
  const hideMyActivity = useUIStore((s) => s.hideMyActivity)
  const chatEnabled = useChatEnabled()
  const addChatMessage = useChatStore((s) => s.addMessage)
  const setChatMessages = useChatStore((s) => s.setMessages)
  const setChatIdentity = useChatStore((s) => s.setIdentity)
  const rejectChatNickname = useChatStore((s) => s.rejectNickname)
  const setUserChannelSelection = useSettingsStore((s) => s.setUserChannelSelection)
  const setPresenceVisible = useSettingsStore((s) => s.setPresenceVisible)
  const setPresence = usePresenceStore((s) => s.setEntries)
  const clearPresence = usePresenceStore((s) => s.clear)

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
  // The token the current socket authenticated with, so each refresh is sent once
  const socketTokenRef = useRef<string | null>(null)
  // The session refresh after a 4001 close while it is in flight; a newer connect or disconnect cancels it
  const authRefreshRef = useRef<object | null>(null)
  // A refreshed token reconnected; a 4001 before the next connection_ack means it was refused too
  const refreshedSinceAckRef = useRef(false)
  // The server announced a restart (1012); reconnects show that until the next connection_ack
  const restartingRef = useRef(false)
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
          refreshedSinceAckRef.current = false
          if (restartingRef.current) {
            restartingRef.current = false
            setStatus('connected')
          }
          // A different build means a deploy: look for the new app version
          noticeServerBuild(message.buildId)
          setCurrentChannel(message.currentChannel ?? null)
          if (message.settings) {
            setUserChannelSelection(message.settings.userChannelSelection)
            setPresenceVisible(message.settings.presenceVisible ?? false)
          }
          if (typeof message.you?.username === 'string') {
            // Loads this user's own nickname, replacing whoever chatted here before
            setChatIdentity(message.you)
            // Without a nickname the server already posts under the sign-in name
            const storedNickname = useChatStore.getState().nickname
            const socket = wsRef.current
            if (storedNickname && socket?.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: 'set_nickname', nickname: storedNickname }))
              logger.debug('WebSocket', `Sent nickname after connection_ack: ${storedNickname}`)
            }
          }
          if (Array.isArray(message.presence)) {
            setPresence(message.presence)
          }
          break

        case 'presence_update':
          logger.debug('WebSocket', 'Received presence_update', message)
          if (Array.isArray(message.presence)) {
            setPresence(message.presence)
          }
          break

        case 'settings_update':
          logger.debug('WebSocket', 'Received settings_update', message)
          if (message.settings) {
            setUserChannelSelection(message.settings.userChannelSelection)
            setPresenceVisible(message.settings.presenceVisible ?? false)
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
              userId: message.userId,
              content: message.content,
              timestamp: message.timestamp,
              kind: message.kind,
              channelId: message.channelId,
              channelName: message.channelName,
              programme: message.programme,
              view: message.view,
            })
          }
          break

        case 'chat_history':
          if (chatEnabled && message.messages) {
            logger.debug('WebSocket', `Received chat history: ${message.messages.length} messages`)
            setChatMessages(message.messages)
          }
          break

        case 'error':
          if (message.code === 'nickname_taken' && typeof message.nickname === 'string') {
            // Another member signed in under that name; go back to the name the server still uses
            logger.info('WebSocket', `Nickname refused: ${message.nickname}`)
            rejectChatNickname(message.nickname)
          } else {
            logger.warn('WebSocket', `Server error: ${message.code ?? 'unknown'}`, message)
          }
          break

        default:
          // Unknown message type - log but don't crash
          logger.warn('WebSocket', `Unknown message type: ${message.type}`, message)
      }
    },
    [setCurrentChannel, setLastChange, chatEnabled, addChatMessage, setChatMessages, setChatIdentity, rejectChatNickname, setUserChannelSelection, setPresenceVisible, setPresence]
  )

  const scheduleReconnect = useCallback(() => {
    // Attempt reconnection if we haven't exceeded retries
    if (retryCountRef.current < MAX_RETRIES) {
      const delay = getBackoffDelay()
      logger.debug(
        'WebSocket',
        `Scheduling reconnect in ${delay}ms (attempt ${retryCountRef.current + 1}/${MAX_RETRIES})`
      )
      setStatus(restartingRef.current ? 'restarting' : 'reconnecting')

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
  }, [getBackoffDelay])

  const connect = useCallback(
    (isReconnect = false) => {
      // Read at connect time: a refresh replaces the token without a new socket
      const token = useAuthStore.getState().token
      if (!token) return

      authRefreshRef.current = null
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
      setStatus(restartingRef.current ? 'restarting' : isReconnect ? 'reconnecting' : 'connecting')

      // Construct WebSocket URL with view and session parameters. The token
      // goes in the first message instead: proxies log URLs.
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const sessionId = getSessionId()
      const wsUrl = `${wsProtocol}//${window.location.host}/api/ws?view=${view}&session_id=${sessionId}`

      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        // Ignore a socket that has already been superseded by a newer one
        if (wsRef.current !== ws) return

        // The server reads nothing else until this arrives. A refresh since
        // connect() is already in the store. The hide preference comes with it,
        // so the server never shows this connection's channel before knowing it.
        // Read from the store so a change doesn't recreate the socket handlers
        const authToken = useAuthStore.getState().token ?? token
        socketTokenRef.current = authToken
        const hideActivity = useUIStore.getState().hideMyActivity
        ws.send(JSON.stringify({ type: 'auth', token: authToken, hideActivity }))

        logger.info('WebSocket', 'Connected successfully')
        if (!restartingRef.current) setStatus('connected')
        retryCountRef.current = 0

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

        if (event.code === 4001) {
          // The token was refused (expired, or signed for someone else).
          // A token that was just refreshed and refused as well ends the sign-in.
          if (refreshedSinceAckRef.current) {
            logger.info('WebSocket', 'Disconnected (refreshed token refused)')
            setStatus('disconnected')
            useAuthStore.getState().logout()
            return
          }
          // One refresh per 4001: success reconnects with the new token, a 401
          // signs out (refreshAuth does that), a temporary failure retries as any drop
          logger.info('WebSocket', 'Disconnected (token refused), refreshing the session')
          setStatus('reconnecting')
          const attempt = {}
          authRefreshRef.current = attempt
          void refreshAuth().then((outcome) => {
            if (authRefreshRef.current !== attempt) return
            authRefreshRef.current = null
            if (outcome === 'refreshed') {
              refreshedSinceAckRef.current = true
              connectRef.current?.(true)
            } else if (outcome === 'temporary') {
              scheduleReconnect()
            } else {
              // Signed out, or a new sign-in that gets its own socket
              setStatus('disconnected')
            }
          })
          return
        }

        logger.info('WebSocket', `Disconnected (code: ${event.code})`)
        // 1012 is Service Restart: a deploy. Proxies may turn it into 1006, so this is best effort
        if (event.code === 1012) restartingRef.current = true
        scheduleReconnect()
      }
    },
    [view, handleMessage, clearTimers, clearPendingChat, scheduleReconnect]
  )

  // Keep connectRef in sync with connect function
  useEffect(() => {
    connectRef.current = connect
  }, [connect])

  const disconnect = useCallback(() => {
    clearTimers()
    clearPendingChat()
    authRefreshRef.current = null
    refreshedSinceAckRef.current = false
    restartingRef.current = false
    const ws = wsRef.current
    if (ws) {
      intentionalClosesRef.current.add(ws)
      ws.close()
      wsRef.current = null
    }
    // Signed out or unmounted: nobody is known to be here any more. (A drop
    // that reconnects keeps the list until the next connection_ack replaces it.)
    clearPresence()
    setStatus('disconnected')
  }, [clearTimers, clearPendingChat, clearPresence])

  const reconnect = useCallback(() => {
    retryCountRef.current = 0
    const auth = useAuthStore.getState()
    if (!auth.token || auth.generation !== generation) return
    connect(true)
  }, [connect, generation])

  useEffect(() => {
    const recover = () => {
      // A session refresh after a 4001 reconnects by itself
      if (authRefreshRef.current) return
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

  // Tell the server when the person changes it; each new socket gets it in its auth message
  useEffect(() => {
    const socket = wsRef.current
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'set_presence_prefs', hideActivity: hideMyActivity }))
      logger.debug('WebSocket', `Sent presence prefs: ${hideMyActivity ? 'hidden' : 'shared'}`)
    }
  }, [hideMyActivity])

  const sendChannelUpdate = useCallback(
    (channelName: string | null, programmeTitle?: string | null, viewType?: 'live' | 'ersatztv', channelId?: string | null, onLive?: boolean) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'channel_update',
            channel: channelName,
            channelId: channelId ?? null,
            programme: programmeTitle ?? null,
            view: viewType ?? null,
            // Following the shared Live slot, not a personal pick of a channel
            onLive: onLive ?? false,
          })
        )
        logger.debug('WebSocket', `Sent channel update: ${channelName || 'null'} - ${programmeTitle || 'null'} (view: ${viewType || 'unchanged'})`)
      }
    },
    []
  )

  // A chat send the server acknowledges by clientMessageId (a message, a share or a suggestion)
  const sendAcknowledged = useCallback(
    (payload: Record<string, unknown>, clientMessageId: string): Promise<ChatSendResult> => {
      const socket = wsRef.current
      if (!chatEnabled || socket?.readyState !== WebSocket.OPEN || pendingChat.current.size >= 20) return Promise.resolve('not-sent')
      return new Promise((finish) => {
        const timer = setTimeout(() => {
          pendingChat.current.delete(clientMessageId)
          finish('unconfirmed')
        }, 10_000)
        pendingChat.current.set(clientMessageId, { finish, timer })
        try {
          socket.send(JSON.stringify({ ...payload, clientMessageId }))
        } catch {
          clearTimeout(timer)
          pendingChat.current.delete(clientMessageId)
          finish('not-sent')
        }
      })
    },
    [chatEnabled]
  )

  const sendChatMessage = useCallback(
    (content: string, clientMessageId: string = createClientMessageId()): Promise<ChatSendResult> =>
      sendAcknowledged({ type: 'chat_message', content }, clientMessageId),
    [sendAcknowledged]
  )

  // No channel is sent: the server takes the channel id this tab last reported
  // (channel_update) and names it from its catalogue, refusing an id it doesn't
  // know, so the card's name matches what Join opens. The id itself is the
  // client's own report, so a card can't prove its sender is on that channel.
  const sendShare = useCallback(
    (clientMessageId: string = createClientMessageId()): Promise<ChatSendResult> =>
      sendAcknowledged({ type: 'share' }, clientMessageId),
    [sendAcknowledged]
  )

  // Only the id is sent: the server names the channel from its catalogue, so
  // a card can't put a name on a channel that isn't what it says
  const sendSuggest = useCallback(
    (channelId: string, clientMessageId: string = createClientMessageId()): Promise<ChatSendResult> =>
      sendAcknowledged({ type: 'suggest', channelId }, clientMessageId),
    [sendAcknowledged]
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

  // Connect on mount when signed in, and again for each new sign-in (not for a refreshed token)
  // Intentionally calls connect (which sets state) in effect - this is the standard WebSocket pattern
  useEffect(() => {
    if (signedIn) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      connect()
    }
    return () => disconnect()
  }, [generation, signedIn, connect, disconnect])

  // A refreshed token moves the open socket's expiry. Declared after the
  // connect effect, so a new sign-in has already replaced the socket here.
  useEffect(() => {
    const socket = wsRef.current
    if (!token || token === socketTokenRef.current || socket?.readyState !== WebSocket.OPEN) return
    socket.send(JSON.stringify({ type: 'reauth', token }))
    socketTokenRef.current = token
    logger.debug('WebSocket', 'Sent reauth with the refreshed token')
  }, [token])

  return { status, reconnect, sendChannelUpdate, sendChatMessage, sendShare, sendSuggest, sendSetNickname }
}
