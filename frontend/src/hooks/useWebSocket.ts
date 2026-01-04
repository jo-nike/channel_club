import { useEffect, useRef, useCallback, useState } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { useChannelStore } from '@/stores/channelStore'
import { logger } from '@/lib/logger'
import { getSessionId } from '@/lib/sessionId'
import type { Channel } from '@/types'

interface WebSocketMessage {
  type: string
  channel?: Channel
  currentChannel?: Channel | null
}

type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

const PING_INTERVAL = 30000
const MAX_RETRIES = 5
const INITIAL_BACKOFF = 1000 // 1 second
const MAX_BACKOFF = 10000 // 10 seconds

interface UseWebSocketOptions {
  view?: 'live' | 'ersatztv'
}

interface UseWebSocketReturn {
  status: ConnectionStatus
  reconnect: () => void
  sendChannelUpdate: (channelName: string | null, programmeTitle?: string | null) => void
}

export function useWebSocket(options: UseWebSocketOptions = {}): UseWebSocketReturn {
  const { view = 'live' } = options
  const token = useAuthStore((s) => s.token)
  const setCurrentChannel = useChannelStore((s) => s.setCurrentChannel)

  const wsRef = useRef<WebSocket | null>(null)
  const pingIntervalRef = useRef<number | null>(null)
  const reconnectTimeoutRef = useRef<number | null>(null)
  const retryCountRef = useRef(0)
  const intentionalCloseRef = useRef(false)
  const connectRef = useRef<((isReconnect?: boolean) => void) | null>(null)

  const [status, setStatus] = useState<ConnectionStatus>('disconnected')

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
          break

        case 'channel_update':
          logger.debug('WebSocket', `Channel update: ${message.channel?.name || 'null'}`)
          if (message.channel) {
            setCurrentChannel(message.channel)
          }
          break

        case 'pong':
          // Ping acknowledged, connection healthy
          logger.debug('WebSocket', 'Received pong')
          break

        default:
          // Unknown message type - log but don't crash
          logger.warn('WebSocket', `Unknown message type: ${message.type}`, message)
      }
    },
    [setCurrentChannel]
  )

  const connect = useCallback(
    (isReconnect = false) => {
      if (!token) return

      // Close existing connection if any
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        intentionalCloseRef.current = true
        wsRef.current.close()
      }

      logger.info('WebSocket', isReconnect ? 'Reconnecting...' : 'Connecting...')
      setStatus(isReconnect ? 'reconnecting' : 'connecting')

      // Construct WebSocket URL with view and session parameters
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const sessionId = getSessionId()
      const wsUrl = `${wsProtocol}//${window.location.host}/api/ws?token=${token}&view=${view}&session_id=${sessionId}`

      const ws = new WebSocket(wsUrl)
      wsRef.current = ws
      intentionalCloseRef.current = false

      ws.onopen = () => {
        logger.info('WebSocket', 'Connected successfully')
        setStatus('connected')
        retryCountRef.current = 0

        // Start ping interval for keep-alive
        pingIntervalRef.current = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }))
          }
        }, PING_INTERVAL)
      }

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data)
          handleMessage(message)
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
        clearTimers()
        wsRef.current = null

        // Don't reconnect if intentionally closed (logout)
        if (intentionalCloseRef.current) {
          logger.info('WebSocket', 'Disconnected (intentional)')
          setStatus('disconnected')
          return
        }

        // Token expired - don't reconnect, redirect to login
        if (event.code === 4001) {
          logger.info('WebSocket', 'Disconnected (token expired)')
          setStatus('disconnected')
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
          logger.warn('WebSocket', 'Max reconnection attempts reached')
          setStatus('disconnected')
        }
      }
    },
    [token, view, handleMessage, clearTimers, getBackoffDelay]
  )

  // Keep connectRef in sync with connect function
  useEffect(() => {
    connectRef.current = connect
  }, [connect])

  const disconnect = useCallback(() => {
    intentionalCloseRef.current = true
    clearTimers()
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    setStatus('disconnected')
  }, [clearTimers])

  const reconnect = useCallback(() => {
    retryCountRef.current = 0
    intentionalCloseRef.current = false
    connect(true)
  }, [connect])

  const sendChannelUpdate = useCallback(
    (channelName: string | null, programmeTitle?: string | null) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'channel_update',
            channel: channelName,
            programme: programmeTitle ?? null,
          })
        )
        logger.debug('WebSocket', `Sent channel update: ${channelName || 'null'} - ${programmeTitle || 'null'}`)
      }
    },
    []
  )

  // Connect on mount when token is available
  // Intentionally calls connect (which sets state) in effect - this is the standard WebSocket pattern
  useEffect(() => {
    if (token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      connect()
    }
    return () => disconnect()
  }, [token, connect, disconnect])

  return { status, reconnect, sendChannelUpdate }
}
