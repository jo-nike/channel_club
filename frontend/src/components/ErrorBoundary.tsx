import { Component, type ErrorInfo, type ReactNode } from 'react'
import { logger } from '@/lib/logger'

interface ErrorBoundaryProps {
  children: ReactNode
  /** Rendered instead of the children after they throw */
  fallback: (props: { error: Error; reset: () => void }) => ReactNode
  /** Changing this value clears a caught error and renders the children again */
  resetKey?: unknown
  /** Logger context, so logs say which part of the app failed */
  name?: string
}

interface ErrorBoundaryState {
  error: Error | null
  resetKey: unknown
}

/**
 * Contains a render error to one part of the screen (the player, the chat
 * panel) so the rest of the app keeps working.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, resetKey: this.props.resetKey }

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  static getDerivedStateFromProps(
    props: ErrorBoundaryProps,
    state: ErrorBoundaryState
  ): Partial<ErrorBoundaryState> | null {
    if (!Object.is(props.resetKey, state.resetKey)) {
      return { error: null, resetKey: props.resetKey }
    }
    return null
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logger.error(this.props.name ?? 'ErrorBoundary', 'Render error', error, info.componentStack)
  }

  reset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    if (this.state.error) {
      return this.props.fallback({ error: this.state.error, reset: this.reset })
    }
    return this.props.children
  }
}
