// TypeScript declarations for Vidstack 0.6.x custom elements in React
// These extend the global JSX namespace to allow using Vidstack web components in TSX

import 'react'

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'media-player': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string
          autoplay?: boolean
          'stream-type'?: 'live' | 'on-demand' | 'unknown'
          'view-type'?: 'audio' | 'video' | 'unknown'
          muted?: boolean
          volume?: number
          'current-time'?: number
          paused?: boolean
          loop?: boolean
          playsinline?: boolean
          poster?: string
          title?: string
          load?: 'eager' | 'idle' | 'visible' | 'custom'
          'log-level'?: 'silent' | 'error' | 'warn' | 'info' | 'debug'
          'prefer-native-hls'?: boolean
        },
        HTMLElement
      >
      'media-outlet': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >
      'media-community-skin': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >
      'media-buffering-indicator': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >
      'media-play-button': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >
      'media-mute-button': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >
      'media-fullscreen-button': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >
      'media-volume-slider': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >
      'media-time-slider': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >
      'media-time': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          type?: 'current' | 'duration' | 'remaining'
        },
        HTMLElement
      >
      'media-live-indicator': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >
      'media-poster': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          alt?: string
        },
        HTMLElement
      >
      'media-captions': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >
      'media-gesture': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          action?:
            | 'toggle:paused'
            | 'toggle:muted'
            | 'toggle:fullscreen'
            | 'toggle:controls'
            | 'seek:-10'
            | 'seek:10'
        },
        HTMLElement
      >
      'media-tooltip': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >
    }
  }
}
