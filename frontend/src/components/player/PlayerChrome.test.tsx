import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@/test/utils'
import { PlayerChrome, type PlayerChromeProps } from './PlayerChrome'
import { PlayerShellContext, type PlayerShell } from './PlayerShellContext'
import type { PlayerMediaAdapter } from './mediaAdapters'
import { focusOverrides } from '@/test/focus'
import { mockViewport } from '@/test/viewport'
import { useAudioStore } from '@/stores/audioStore'
import { useClipStore } from '@/stores/clipStore'
import { useChatStore } from '@/stores/chatStore'

// Mock the highlight feature hook - disabled by default
const highlight = vi.hoisted(() => ({ enabled: false }))
vi.mock('@/hooks/useHighlightFeature', () => ({
  useHighlightFeature: () => ({ isEnabled: highlight.enabled, isLoading: false }),
}))
const clipStatus = vi.hoisted(() => ({ loaded: true, recording: true }))
vi.mock('@/hooks/useHighlightStatus', () => ({
  useHighlightStatus: () => ({
    status: {
      enabled: true,
      recording: clipStatus.recording,
      ready: clipStatus.recording,
      bufferSeconds: clipStatus.recording ? 60 : 0,
      maxBufferSeconds: 60,
    },
    loaded: clipStatus.loaded,
  }),
}))
// Rendered once there is a channel; it would ask the server whether casting is on
const cast = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }))
vi.mock('@/components/CastButton', () => ({
  CastButton: (props: Record<string, unknown>) => {
    cast.props = props
    return null
  },
}))

// Script volume detection (false on iOS/iPadOS Safari)
const volumeSupport = vi.hoisted(() => ({ canSet: true }))
vi.mock('@/hooks/useCanSetVolume', () => ({ useCanSetVolume: () => volumeSupport.canSet }))

const tv = vi.hoisted(() => ({ mode: false }))
vi.mock('@/hooks/useTVMode', () => ({ useTVMode: () => tv.mode }))

// VITE_CHAT_ENABLED: off unless a test turns it on
const chatFeature = vi.hoisted(() => ({ enabled: false }))
vi.mock('@/hooks/useChatEnabled', () => ({ useChatEnabled: () => chatFeature.enabled }))

// A stand-in engine: the chrome only sees this interface
const fakeAdapter = (overrides: Partial<PlayerMediaAdapter> = {}): PlayerMediaAdapter => ({
  isPlaying: false,
  elementMuted: false,
  canPlay: true,
  togglePaused: vi.fn(),
  unmuteElement: vi.fn(),
  streamType: 'mpegts',
  isBehindLive: false,
  jumpToLive: vi.fn(),
  ...overrides,
})

const fakeShell = (overrides: Partial<PlayerShell> = {}): PlayerShell => ({
  containerRef: { current: null },
  isFullscreen: false,
  toggleFullscreen: vi.fn(),
  isTheaterMode: false,
  toggleTheaterMode: vi.fn(),
  controlsVisible: true,
  setPlaying: vi.fn(),
  setHoveringControls: vi.fn(),
  isInfoRailVisible: false,
  setInfoRailVisible: vi.fn(),
  behindLive: null,
  setBehindLive: vi.fn(),
  isLivePaused: false,
  setLivePaused: vi.fn(),
  reload: vi.fn(),
  reloadKey: 0,
  ...overrides,
})

interface Setup {
  adapter?: Partial<PlayerMediaAdapter>
  shell?: Partial<PlayerShell>
  props?: Partial<PlayerChromeProps>
}

const renderChrome = ({ adapter: adapterOverrides, shell: shellOverrides, props }: Setup = {}) => {
  const adapter = fakeAdapter(adapterOverrides)
  const shell = fakeShell(shellOverrides)
  const ui = (next: Setup = {}) => (
    <PlayerShellContext value={{ ...shell, ...next.shell }}>
      <PlayerChrome adapter={{ ...adapter, ...next.adapter }} {...props} {...next.props} />
    </PlayerShellContext>
  )
  const view = render(ui())
  return { ...view, adapter, shell, update: (next: Setup) => view.rerender(ui(next)) }
}

const toolbar = () => screen.getByRole('toolbar', { name: 'Video controls' })
const slider = () => screen.getByRole('slider', { name: 'Volume' })

describe('PlayerChrome', () => {
  beforeEach(() => {
    volumeSupport.canSet = true
    tv.mode = false
    highlight.enabled = false
    chatFeature.enabled = false
    useChatStore.setState({ isOpen: false, unreadCount: 0 })
    cast.props = null
    useAudioStore.setState({ volume: 1, muted: false, savedMuteNotice: false, previewHolds: 0 })
  })

  describe('rendering', () => {
    it('renders all control buttons', () => {
      renderChrome()

      expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Mute' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Fullscreen' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Theater mode' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Video filters' })).toBeInTheDocument()
    })

    it('renders volume slider', () => {
      renderChrome()

      expect(slider()).toBeInTheDocument()
    })

    it('renders control bar container', () => {
      renderChrome()

      // .video-controls keeps the bar clear of the notch (index.css) and marks
      // taps on it as using the controls (useAutoHide)
      expect(toolbar()).toHaveClass('video-controls')
    })

    it('gives every button a 48px target and the over-video focus ring', () => {
      renderChrome()

      for (const name of ['Play', 'Mute', 'Reload stream', 'Theater mode', 'Fullscreen']) {
        const button = screen.getByRole('button', { name })
        expect(button).toHaveClass('min-h-[48px]', 'min-w-[48px]', 'focus-ring-media')
        expect(focusOverrides(button)).toEqual([])
      }
    })

    it('gives the volume slider the over-video focus ring too', () => {
      renderChrome()

      expect(slider()).toHaveClass('focus-ring-media')
      expect(focusOverrides(slider())).toEqual([])
    })
  })

  describe('play/pause', () => {
    it('shows pause when the engine is playing', () => {
      renderChrome({ adapter: { isPlaying: true } })

      expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
    })

    it('shows play when the engine is paused', () => {
      renderChrome({ adapter: { isPlaying: false } })

      expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
    })

    it('play asks the engine to toggle', () => {
      const { adapter } = renderChrome()

      fireEvent.click(screen.getByRole('button', { name: 'Play' }))

      expect(adapter.togglePaused).toHaveBeenCalledTimes(1)
    })

    it('pause asks the engine to toggle', () => {
      const { adapter } = renderChrome({ adapter: { isPlaying: true } })

      fireEvent.click(screen.getByRole('button', { name: 'Pause' }))

      expect(adapter.togglePaused).toHaveBeenCalledTimes(1)
    })
  })

  describe('key hints', () => {
    it.each([
      ['Play', 'Play (Space)', 'Space', {}],
      ['Pause', 'Pause (Space)', 'Space', { adapter: { isPlaying: true } }],
      ['Mute', 'Mute (M)', 'M', {}],
      ['Reload stream', 'Reload stream (R)', 'R', {}],
      ['Theater mode', 'Theater mode (T)', 'T', {}],
      ['Exit theater mode', 'Exit theater mode (T)', 'T', { shell: { isTheaterMode: true } }],
      ['Fullscreen', 'Fullscreen (F)', 'F', {}],
      ['Exit fullscreen', 'Exit fullscreen (F)', 'F', { shell: { isFullscreen: true } }],
    ] as const)('%s: the tooltip reads %s', async (name, tooltip, key, setup: Setup) => {
      renderChrome(setup)
      const button = screen.getByRole('button', { name })

      fireEvent.focus(button)

      expect(await screen.findByRole('tooltip')).toHaveTextContent(tooltip)
      expect(button).toHaveAttribute('aria-keyshortcuts', key)
    })

    it('keeps the key out of the button names', () => {
      renderChrome()

      for (const name of ['Play', 'Mute', 'Reload stream', 'Theater mode', 'Fullscreen']) {
        expect(screen.getByRole('button', { name })).toHaveAccessibleName(name)
      }
    })
  })

  describe('volume', () => {
    it('shows the muted icon and Unmute while the saved mute is on', () => {
      useAudioStore.setState({ volume: 1, muted: true })
      renderChrome()

      expect(screen.getByRole('button', { name: /^Unmute/ })).toBeInTheDocument()
    })

    it('shows Mute while the sound is on', () => {
      renderChrome()

      expect(screen.getByRole('button', { name: 'Mute' })).toBeInTheDocument()
    })

    it('Mute saves the mute', () => {
      const { adapter } = renderChrome()

      fireEvent.click(screen.getByRole('button', { name: 'Mute' }))

      expect(useAudioStore.getState().muted).toBe(true)
      expect(adapter.unmuteElement).not.toHaveBeenCalled()
    })

    it('Unmute clears the saved mute and unmutes the element', () => {
      useAudioStore.setState({ volume: 0.4, muted: true })
      const { adapter } = renderChrome({ adapter: { elementMuted: true } })

      fireEvent.click(screen.getByRole('button', { name: /^Unmute/ }))

      expect(useAudioStore.getState()).toMatchObject({ volume: 0.4, muted: false })
      expect(adapter.unmuteElement).toHaveBeenCalledTimes(1)
    })

    it('a mute only the element has (autoplay, preview hold) shows Unmute, which unmutes the element', () => {
      const { adapter } = renderChrome({ adapter: { elementMuted: true } })

      fireEvent.click(screen.getByRole('button', { name: /^Unmute/ }))

      expect(useAudioStore.getState().muted).toBe(false)
      expect(adapter.unmuteElement).toHaveBeenCalledTimes(1)
    })

    it('the slider saves the level and clears a mute only the element had', () => {
      const { adapter } = renderChrome({ adapter: { elementMuted: true } })

      fireEvent.change(slider(), { target: { value: '0.5' } })

      expect(useAudioStore.getState()).toMatchObject({ volume: 0.5, muted: false })
      expect(adapter.unmuteElement).toHaveBeenCalledTimes(1)
    })

    it('dragging the slider to 0 mutes and keeps the level', () => {
      useAudioStore.setState({ volume: 0.3, muted: false })
      const { adapter } = renderChrome()

      fireEvent.change(slider(), { target: { value: '0' } })

      expect(useAudioStore.getState()).toMatchObject({ volume: 0.3, muted: true })
      expect(adapter.unmuteElement).not.toHaveBeenCalled()
    })
  })

  describe('while muted', () => {
    it('the slider keeps the saved level, dimmed, and Unmute names it', () => {
      useAudioStore.setState({ volume: 0.8, muted: true })
      renderChrome()

      expect(slider()).toHaveValue('0.8')
      expect(slider()).toHaveClass('opacity-50')
      expect(screen.getByRole('button', { name: 'Unmute (80%)' })).toBeInTheDocument()
    })

    it('names the level unmuting gives when the saved one is barely audible', () => {
      useAudioStore.setState({ volume: 0.05, muted: true })
      renderChrome()

      expect(screen.getByRole('button', { name: 'Unmute (25%)' })).toBeInTheDocument()
    })

    it('the tooltip says the same as the button, with its key', async () => {
      useAudioStore.setState({ volume: 0.8, muted: true })
      renderChrome()

      fireEvent.focus(screen.getByRole('button', { name: 'Unmute (80%)' }))

      expect(await screen.findByRole('tooltip')).toHaveTextContent('Unmute (80%) (M)')
    })

    it('the slider follows the saved mute: an element-only mute leaves it undimmed', () => {
      useAudioStore.setState({ volume: 0.8, muted: false })
      renderChrome({ adapter: { elementMuted: true } })

      expect(slider()).toHaveValue('0.8')
      expect(slider()).not.toHaveClass('opacity-50')
      expect(screen.getByRole('button', { name: 'Unmute (80%)' })).toBeInTheDocument()
    })

    it('the slider is not dimmed with the sound on', () => {
      useAudioStore.setState({ volume: 0.8, muted: false })
      renderChrome()

      expect(slider()).toHaveValue('0.8')
      expect(slider()).not.toHaveClass('opacity-50')
    })
  })

  describe('browsers that ignore script volume (iOS/iPadOS)', () => {
    it('hides the volume slider and keeps Mute', () => {
      volumeSupport.canSet = false
      renderChrome()

      expect(screen.queryByRole('slider', { name: 'Volume' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Mute' })).toBeInTheDocument()
    })

    it('shows the volume slider where volume can be set', () => {
      volumeSupport.canSet = true
      renderChrome()

      expect(slider()).toBeInTheDocument()
    })

    it('Unmute names no level, which the browser would ignore', () => {
      volumeSupport.canSet = false
      useAudioStore.setState({ volume: 0.3, muted: true })
      renderChrome()

      expect(screen.getByRole('button', { name: 'Unmute' })).toBeInTheDocument()
    })
  })

  describe('fullscreen', () => {
    it('toggles the shell fullscreen', () => {
      const { shell } = renderChrome()

      fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' }))

      expect(shell.toggleFullscreen).toHaveBeenCalledTimes(1)
    })

    it('shows Exit fullscreen while the shell is fullscreen', () => {
      renderChrome({ shell: { isFullscreen: true } })

      expect(screen.getByRole('button', { name: 'Exit fullscreen' })).toBeInTheDocument()
    })
  })

  describe('reload', () => {
    it('reloads the stream through the shell, keeping it', () => {
      const { shell } = renderChrome()

      fireEvent.click(screen.getByRole('button', { name: 'Reload stream' }))

      expect(shell.reload).toHaveBeenCalledTimes(1)
    })

    it.each([
      ['fullscreen', { isFullscreen: true }],
      ['theater', { isTheaterMode: true }],
    ])('is there in %s, where the page header is gone', (_mode, shell) => {
      renderChrome({ shell })
      expect(screen.getByRole('button', { name: 'Reload stream' })).toBeInTheDocument()
    })

    it('shows on phones too, hidden only below 400px wide, where the bar has no room', () => {
      renderChrome({ props: { isMobile: true } })

      const reload = screen.getByRole('button', { name: 'Reload stream' })
      expect(reload).toHaveClass('max-[399px]:hidden')
      expect(reload).toHaveAttribute('tabindex', '0')
    })

    it('leaves the tab order with the rest of the bar when the controls hide', () => {
      renderChrome({ shell: { controlsVisible: false } })
      expect(screen.getByRole('button', { name: 'Reload stream' })).toHaveAttribute('tabindex', '-1')
    })
  })

  describe('theater mode', () => {
    it('toggles the page theater layout', () => {
      const { shell } = renderChrome()

      fireEvent.click(screen.getByRole('button', { name: 'Theater mode' }))

      expect(shell.toggleTheaterMode).toHaveBeenCalledTimes(1)
    })

    it('shows exit theater mode label when in theater mode', () => {
      renderChrome({ shell: { isTheaterMode: true } })

      expect(screen.getByRole('button', { name: 'Exit theater mode' })).toBeInTheDocument()
    })

    it('hides theater mode button when in fullscreen', () => {
      renderChrome({ shell: { isFullscreen: true } })

      expect(screen.queryByRole('button', { name: /theater/i })).not.toBeInTheDocument()
    })

    it('shows theater mode button when not in fullscreen', () => {
      renderChrome({ shell: { isFullscreen: false } })

      expect(screen.getByRole('button', { name: 'Theater mode' })).toBeInTheDocument()
    })

    it('hides theater mode button on mobile', () => {
      renderChrome({ props: { isMobile: true } })

      expect(screen.queryByRole('button', { name: /theater/i })).not.toBeInTheDocument()
    })

    describe('on touch screens', () => {
      const setupMatchMedia = window.matchMedia
      afterEach(() => { window.matchMedia = setupMatchMedia })

      it.each([
        ['a tablet on its side', { width: 1024, height: 768 }],
        ['an iPad Pro on its side', { width: 1366, height: 1024 }],
      ])('offers theater on %s, where a tap brings the bar back', (_device, size) => {
        mockViewport({ ...size, pointer: 'coarse' })
        const { shell } = renderChrome()

        fireEvent.click(screen.getByRole('button', { name: 'Theater mode' }))

        expect(shell.toggleTheaterMode).toHaveBeenCalledTimes(1)
      })

      it('offers the way out of theater on a tablet', () => {
        mockViewport({ width: 1024, height: 768, pointer: 'coarse' })
        renderChrome({ shell: { isTheaterMode: true } })

        expect(screen.getByRole('button', { name: 'Exit theater mode' })).toBeInTheDocument()
      })

      it('keeps the way out of theater when the tablet is turned upright', () => {
        mockViewport({ width: 820, height: 1180, pointer: 'coarse' })
        const { shell } = renderChrome({ shell: { isTheaterMode: true }, props: { isMobile: true } })

        fireEvent.click(screen.getByRole('button', { name: 'Exit theater mode' }))

        expect(shell.toggleTheaterMode).toHaveBeenCalledTimes(1)
      })

      it.each([
        ['upright', { width: 390, height: 844 }],
        ['on its side', { width: 844, height: 390 }],
      ])('leaves theater out on a phone %s', (_orientation, size) => {
        mockViewport({ ...size, pointer: 'coarse' })
        renderChrome()

        expect(screen.queryByRole('button', { name: /theater/i })).not.toBeInTheDocument()
      })
    })
  })

  describe('TV browsers', () => {
    // webOS pointer mode can report pointer:coarse, so TV mode must win over isMobile
    it('renders Fullscreen on a TV that looks like a touch device', () => {
      tv.mode = true
      renderChrome({ props: { isMobile: true } })

      expect(screen.getByRole('button', { name: 'Fullscreen' })).toBeInTheDocument()
    })

    // The couch layout always fills the screen: there is no theater to switch
    it('offers no theater button on a TV, in or out of theater', () => {
      tv.mode = true
      const { unmount } = renderChrome()
      expect(screen.queryByRole('button', { name: /theater/i })).not.toBeInTheDocument()
      unmount()

      renderChrome({ shell: { isTheaterMode: true } })
      expect(screen.queryByRole('button', { name: /theater/i })).not.toBeInTheDocument()
    })

    it('the TV fullscreen button toggles the shell fullscreen', () => {
      tv.mode = true
      const { shell } = renderChrome({ props: { isMobile: true } })

      fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' }))

      expect(shell.toggleFullscreen).toHaveBeenCalledTimes(1)
    })

    it('still hides the theater button in fullscreen on a TV', () => {
      tv.mode = true
      renderChrome({ shell: { isFullscreen: true } })

      expect(screen.queryByRole('button', { name: /theater/i })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Exit fullscreen' })).toBeInTheDocument()
    })
  })

  describe('control bar positioning', () => {
    it('is a full-width strip along the bottom edge, not an inset card', () => {
      renderChrome()

      const bar = toolbar()
      expect(bar).toHaveClass('absolute', 'inset-x-0', 'bottom-0')
      expect(bar).not.toHaveClass('bottom-4', 'left-4', 'right-4', 'rounded-lg')
    })

    it('sits on a gradient scrim that fades up from black, not a solid box', () => {
      renderChrome()

      expect(toolbar()).toHaveClass('bg-gradient-to-t', 'from-black/80', 'to-transparent')
      expect(toolbar()).not.toHaveClass('bg-black/70')
    })

    it('uses the padding classes index.css widens to clear the notch and home indicator', () => {
      renderChrome()

      expect(toolbar()).toHaveClass('px-3', 'pb-2')
    })

    it('keeps its position regardless of theater mode', () => {
      const { update } = renderChrome({ shell: { isTheaterMode: false } })

      const bar = toolbar()
      expect(bar).toHaveClass('bottom-0')

      update({ shell: { isTheaterMode: true } })
      expect(bar).toHaveClass('bottom-0', 'inset-x-0')
    })
  })

  describe('cast', () => {
    it('casts the stream the engine plays, the way the engine fetches it', () => {
      renderChrome({
        adapter: { streamType: 'hls' },
        props: { channelId: '42', channelName: 'Sportsnet', streamUrl: 'https://fixture/42.m3u8' },
      })

      expect(cast.props).toMatchObject({
        channelId: '42',
        streamType: 'hls',
        streamUrl: 'https://fixture/42.m3u8',
        channelName: 'Sportsnet',
        isVisible: true,
      })
    })

    it('has nothing to cast without a channel', () => {
      renderChrome()

      expect(cast.props).toBeNull()
    })
  })

  describe('filters', () => {
    const added: Element[] = []
    afterEach(() => {
      added.splice(0).forEach((element) => element.remove())
    })

    it('the filter menu opens inside the player shell, so it shows in fullscreen', async () => {
      const container = document.body.appendChild(document.createElement('div'))
      added.push(container)
      renderChrome({ shell: { containerRef: { current: container } } })

      fireEvent.click(screen.getByRole('button', { name: 'Video filters' }))

      expect(container).toContainElement(await screen.findByText('Video Filters'))
    })
  })

  describe('clip capture', () => {
    beforeEach(() => {
      highlight.enabled = true
      clipStatus.loaded = true
      clipStatus.recording = true
      useClipStore.setState({ session: null })
    })

    it('shows the clip control as checking until the first status poll answers', () => {
      clipStatus.loaded = false
      renderChrome({ props: { channelId: '42', channelName: 'Sportsnet' } })

      expect(screen.getByRole('button', { name: 'Checking clip…' })).toBeDisabled()
    })

    it('opens the clip session on this channel and leaves the editor to the player shell', () => {
      renderChrome({ props: { channelId: '42', channelName: 'Sportsnet' } })

      fireEvent.click(screen.getByRole('button', { name: /Capture clip/ }))

      expect(useClipStore.getState().session).toEqual({ channelId: '42', channelName: 'Sportsnet' })
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('leaves the session open when the control bar unmounts', () => {
      const { unmount } = renderChrome({ props: { channelId: '42', channelName: 'Sportsnet' } })
      fireEvent.click(screen.getByRole('button', { name: /Capture clip/ }))

      unmount()

      expect(useClipStore.getState().session).toEqual({ channelId: '42', channelName: 'Sportsnet' })
    })

    it('is not offered on a TV', () => {
      tv.mode = true
      renderChrome({ props: { channelId: '42', channelName: 'Sportsnet' } })

      expect(screen.queryByRole('button', { name: /Capture clip/ })).not.toBeInTheDocument()
    })
  })

  describe('channel rocker', () => {
    const WIDE = '(min-width: 1024px)'
    const ROOMY = '(min-width: 768px)'
    const setupMatchMedia = window.matchMedia
    // setup.ts answers every media query with false; this reports the given ones as matching
    const matchMediaQueries = (matching: string[]) => {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: (query: string) => ({
          matches: matching.includes(query),
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(() => true),
        }),
      })
    }
    afterEach(() => {
      Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: setupMatchMedia })
    })
    const rocker = () => screen.queryByRole('group', { name: 'Channel' })

    it('shows at 1024px and wider, and steps through the shell', () => {
      matchMediaQueries([WIDE])
      const stepChannel = vi.fn()
      renderChrome({ shell: { stepChannel } })

      expect(toolbar()).toContainElement(rocker())
      fireEvent.click(screen.getByRole('button', { name: 'Channel up' }))
      fireEvent.click(screen.getByRole('button', { name: 'Channel down' }))

      expect(stepChannel.mock.calls).toEqual([[1], [-1]])
    })

    it('is left out below 1024px (the bar is already full at 640-768px)', () => {
      matchMediaQueries([ROOMY])
      renderChrome({ shell: { stepChannel: vi.fn() } })

      expect(rocker()).not.toBeInTheDocument()
    })

    it.each([
      ['theater', { isTheaterMode: true }],
      ['fullscreen', { isFullscreen: true }],
    ])('shows from 768px to 1024px in %s, where the sidebar and guide are gone', (_mode, shell) => {
      matchMediaQueries([ROOMY])
      renderChrome({ shell: { ...shell, stepChannel: vi.fn() }, props: { isMobile: true } })

      expect(rocker()).toBeInTheDocument()
    })

    it.each([
      ['theater', { isTheaterMode: true }],
      ['fullscreen', { isFullscreen: true }],
    ])('is left out on a phone in %s, so Exit fullscreen stays on screen', (_mode, shell) => {
      renderChrome({ shell: { ...shell, stepChannel: vi.fn() }, props: { isMobile: true } })

      expect(rocker()).not.toBeInTheDocument()
    })

    it('comes and goes as the shell enters and leaves theater', () => {
      matchMediaQueries([ROOMY])
      const stepChannel = vi.fn()
      const { update } = renderChrome({ shell: { stepChannel } })
      expect(rocker()).not.toBeInTheDocument()

      update({ shell: { stepChannel, isTheaterMode: true } })
      expect(rocker()).toBeInTheDocument()

      update({ shell: { stepChannel, isTheaterMode: false } })
      expect(rocker()).not.toBeInTheDocument()
    })

    // jsdom can't lay the bar out, so these pin the rule: the bar is a size
    // container and the rocker drops out below the width every control plus
    // the rocker needs (Chrome: ~742px of content with Theater, ~678px without)
    it('drops out while the bar itself is too narrow, such as beside the docked chat', () => {
      matchMediaQueries([WIDE])
      renderChrome({ shell: { stepChannel: vi.fn() } })

      expect(toolbar()).toHaveClass('@container')
      expect(rocker()).toHaveClass('@max-[48rem]:hidden')
    })

    it('needs less of the bar in fullscreen, where the Theater button is gone', () => {
      matchMediaQueries([WIDE])
      renderChrome({ shell: { stepChannel: vi.fn(), isFullscreen: true } })

      expect(screen.queryByRole('button', { name: /theater/i })).not.toBeInTheDocument()
      expect(rocker()).toHaveClass('@max-[44rem]:hidden')
      expect(rocker()).not.toHaveClass('@max-[48rem]:hidden')
    })

    it('is not there without a zap to step through', () => {
      matchMediaQueries([WIDE])
      renderChrome({ shell: { isTheaterMode: true } })

      expect(rocker()).not.toBeInTheDocument()
    })

    it('leaves the tab order with the rest of the bar when the controls hide', () => {
      matchMediaQueries([ROOMY])
      renderChrome({ shell: { stepChannel: vi.fn(), isTheaterMode: true, controlsVisible: false } })

      expect(screen.getByRole('button', { name: 'Channel up' })).toHaveAttribute('tabindex', '-1')
      expect(screen.getByRole('button', { name: 'Channel down' })).toHaveAttribute('tabindex', '-1')
    })
  })

  describe('chat', () => {
    const LANDSCAPE = '(pointer: coarse) and (orientation: landscape) and (max-height: 500px)'
    const COARSE = '(pointer: coarse)'
    const WIDE = '(min-width: 1024px)'
    const setupMatchMedia = window.matchMedia
    // setup.ts answers every media query with false; this reports the given ones as matching
    const matchMediaQueries = (matching: string[]) => {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: (query: string) => ({
          matches: matching.includes(query),
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(() => true),
        }),
      })
    }
    beforeEach(() => {
      chatFeature.enabled = true
    })
    afterEach(() => {
      Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: setupMatchMedia })
    })
    const chatButton = () => screen.queryByRole('button', { name: /chat/i })

    it.each([
      ['theater', { isTheaterMode: true }],
      ['fullscreen', { isFullscreen: true }],
    ])('is in the bar in %s, with the unread count', (_mode, shell) => {
      useChatStore.setState({ unreadCount: 3 })
      renderChrome({ shell })

      const button = screen.getByRole('button', { name: 'Open chat (3 new)' })
      expect(toolbar()).toContainElement(button)
      expect(button).toHaveTextContent('3')
      expect(button).toHaveClass('min-h-[48px]', 'min-w-[48px]', 'focus-ring-media')
      expect(button).toHaveAttribute('aria-controls', 'chat-panel')
      expect(button).toHaveAttribute('aria-keyshortcuts', 'C')
    })

    it('is on a phone held sideways, where the header is gone', () => {
      matchMediaQueries([LANDSCAPE, COARSE])
      renderChrome({ props: { isMobile: true } })

      expect(screen.getByRole('button', { name: 'Open chat' })).toBeInTheDocument()
    })

    it('shows no badge with nothing unread', () => {
      renderChrome({ shell: { isTheaterMode: true } })

      expect(screen.getByRole('button', { name: 'Open chat' }).textContent).toBe('')
    })

    it('caps the badge at 9+', () => {
      useChatStore.setState({ unreadCount: 12 })
      renderChrome({ shell: { isTheaterMode: true } })

      expect(screen.getByRole('button', { name: 'Open chat (12 new)' })).toHaveTextContent('9+')
    })

    it('follows new messages', () => {
      renderChrome({ shell: { isTheaterMode: true } })

      act(() => useChatStore.setState({ unreadCount: 2 }))

      expect(screen.getByRole('button', { name: 'Open chat (2 new)' })).toHaveTextContent('2')
    })

    it('is left out of the normal layout, where the header has the chat button', () => {
      renderChrome()

      expect(chatButton()).not.toBeInTheDocument()
    })

    it('is left out of fullscreen on a phone in portrait, where the bar has no room', () => {
      renderChrome({ shell: { isFullscreen: true }, props: { isMobile: true } })

      expect(chatButton()).not.toBeInTheDocument()
    })

    it.each([
      ['theater', { isTheaterMode: true }],
      ['fullscreen', { isFullscreen: true }],
    ])('is not offered on a TV in %s', (_mode, shell) => {
      tv.mode = true
      renderChrome({ shell })

      expect(chatButton()).not.toBeInTheDocument()
    })

    it('is not offered while chat is turned off', () => {
      chatFeature.enabled = false
      renderChrome({ shell: { isTheaterMode: true } })

      expect(chatButton()).not.toBeInTheDocument()
    })

    it('opens and closes chat, which clears the unread count', () => {
      useChatStore.setState({ unreadCount: 3 })
      renderChrome({ shell: { isTheaterMode: true } })

      fireEvent.click(screen.getByRole('button', { name: 'Open chat (3 new)' }))
      expect(useChatStore.getState()).toMatchObject({ isOpen: true, unreadCount: 0 })
      expect(screen.getByRole('button', { name: 'Open chat' })).toHaveAttribute('aria-expanded', 'true')

      fireEvent.click(screen.getByRole('button', { name: 'Open chat' }))
      expect(useChatStore.getState().isOpen).toBe(false)
      expect(screen.getByRole('button', { name: 'Open chat' })).toHaveAttribute('aria-expanded', 'false')
    })

    it('stays in theater when opening chat there', () => {
      const { shell } = renderChrome({ shell: { isTheaterMode: true } })

      fireEvent.click(screen.getByRole('button', { name: 'Open chat' }))

      expect(shell.toggleTheaterMode).not.toHaveBeenCalled()
      expect(shell.toggleFullscreen).not.toHaveBeenCalled()
    })

    // The panel is outside the shell, so it would open hidden behind fullscreen
    it('leaves fullscreen to open chat', () => {
      const { shell } = renderChrome({ shell: { isFullscreen: true } })

      fireEvent.click(screen.getByRole('button', { name: 'Open chat' }))

      expect(shell.toggleFullscreen).toHaveBeenCalledTimes(1)
      expect(useChatStore.getState().isOpen).toBe(true)
    })

    it('closes chat in fullscreen without leaving it', () => {
      useChatStore.setState({ isOpen: true })
      const { shell } = renderChrome({ shell: { isFullscreen: true } })

      fireEvent.click(screen.getByRole('button', { name: 'Open chat' }))

      expect(shell.toggleFullscreen).not.toHaveBeenCalled()
      expect(useChatStore.getState().isOpen).toBe(false)
    })

    it('the tooltip names the key', async () => {
      renderChrome({ shell: { isTheaterMode: true } })

      fireEvent.focus(screen.getByRole('button', { name: 'Open chat' }))

      expect(await screen.findByRole('tooltip')).toHaveTextContent('Open chat (C)')
    })

    it.each([
      [true, '0'],
      [false, '-1'],
    ])('with the controls showing: %s, its tabIndex is %s', (controlsVisible, tabIndex) => {
      renderChrome({ shell: { isTheaterMode: true, controlsVisible } })

      expect(screen.getByRole('button', { name: 'Open chat' })).toHaveAttribute('tabindex', tabIndex)
    })

    // It takes another 64px of the bar, so the rocker needs a wider bar
    it.each([
      ['theater', { isTheaterMode: true }, '@max-[52rem]:hidden'],
      ['fullscreen', { isFullscreen: true }, '@max-[48rem]:hidden'],
    ])('leaves the channel rocker a wider bar to fit in %s', (_mode, shell, fitClass) => {
      matchMediaQueries([WIDE])
      renderChrome({ shell: { ...shell, stepChannel: vi.fn() } })

      expect(screen.getByRole('group', { name: 'Channel' })).toHaveClass(fitClass)
    })
  })

  describe('phone landscape', () => {
    const LANDSCAPE = '(pointer: coarse) and (orientation: landscape) and (max-height: 500px)'
    const COARSE = '(pointer: coarse)'
    const ROOMY = '(min-width: 768px)'
    const setupMatchMedia = window.matchMedia
    // setup.ts answers every media query with false; this reports the given ones as matching
    const matchMediaQueries = (matching: string[]) => {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: (query: string) => ({
          matches: matching.includes(query),
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(() => true),
        }),
      })
    }
    // An 844 x 390 phone held sideways
    const holdSideways = () => matchMediaQueries([LANDSCAPE, COARSE, ROOMY])
    beforeEach(() => {
      highlight.enabled = true
      clipStatus.loaded = true
      clipStatus.recording = true
    })
    afterEach(() => {
      Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: setupMatchMedia })
    })

    it('tightens the strip to a thin scrim', () => {
      holdSideways()
      renderChrome({ props: { isMobile: true } })

      expect(toolbar()).toHaveClass('p-1.5')
      expect(toolbar()).not.toHaveClass('pt-8')
      expect(toolbar()).not.toHaveClass('px-3')
    })

    it('keeps the roomy strip elsewhere', () => {
      renderChrome()

      expect(toolbar()).toHaveClass('px-3', 'pb-2', 'pt-8')
      expect(toolbar()).not.toHaveClass('p-1.5')
    })

    it('gives every button a 44px target and keeps the over-video focus ring', () => {
      holdSideways()
      renderChrome({ props: { isMobile: true, channelId: '42', channelName: 'Sportsnet' } })

      for (const name of ['Play', 'Mute', 'Reload stream', 'Fullscreen', /Capture clip/]) {
        const button = screen.getByRole('button', { name })
        expect(button).toHaveClass('min-h-[44px]', 'min-w-[44px]', 'focus-ring-media')
        expect(button).not.toHaveClass('min-h-[48px]')
      }
      // The Cast and filter buttons are drawn elsewhere at 48px; the strip brings them down
      expect(toolbar()).toHaveClass('[&_.control-button]:min-h-[44px]', '[&_.control-button]:min-w-[44px]')
    })

    it('shows the rocker at 44px when fullscreen leaves room for it', () => {
      holdSideways()
      renderChrome({ shell: { isFullscreen: true, stepChannel: vi.fn() }, props: { isMobile: true } })

      expect(screen.getByRole('button', { name: 'Channel up' })).toHaveClass('min-h-[44px]')
    })

    it('leaves out the clip control while the channel is not recording', () => {
      clipStatus.recording = false
      holdSideways()
      renderChrome({ props: { isMobile: true, channelId: '42', channelName: 'Sportsnet' } })

      expect(screen.queryByRole('button', { name: 'Clip unavailable' })).not.toBeInTheDocument()
      expect(screen.queryByText('Clip unavailable')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Fullscreen' })).toBeInTheDocument()
    })

    it('keeps the disabled clip control, with its tooltip, on a desktop', async () => {
      clipStatus.recording = false
      renderChrome({ props: { channelId: '42', channelName: 'Sportsnet' } })

      const button = screen.getByRole('button', { name: 'Clip unavailable' })
      expect(button).toBeDisabled()
      expect(button).toHaveClass('min-h-[48px]')
      fireEvent.focus(button)
      expect(await screen.findByRole('tooltip')).toHaveTextContent('Clip unavailable')
    })

    it('keeps the disabled clip control on a phone in portrait', () => {
      clipStatus.recording = false
      matchMediaQueries([COARSE])
      renderChrome({ props: { isMobile: true, channelId: '42', channelName: 'Sportsnet' } })

      expect(screen.getByRole('button', { name: 'Clip unavailable' })).toBeDisabled()
    })
  })

  describe('visibility', () => {
    // The shell's one auto-hide, which overlays read too
    it('is visible while the shell shows the controls', () => {
      renderChrome({ shell: { controlsVisible: true } })

      expect(toolbar()).toHaveClass('opacity-100')
      expect(toolbar()).not.toHaveClass('opacity-0')
    })

    it('is hidden while the shell hides the controls', () => {
      renderChrome({ shell: { controlsVisible: false } })

      expect(toolbar()).toHaveClass('opacity-0')
      expect(toolbar()).toHaveClass('pointer-events-none')
    })

    it('follows the shell as it hides and shows the controls', () => {
      const { update } = renderChrome({ shell: { controlsVisible: true } })

      update({ shell: { controlsVisible: false } })
      expect(toolbar()).toHaveClass('opacity-0')

      update({ shell: { controlsVisible: true } })
      expect(toolbar()).toHaveClass('opacity-100')
    })

    it('buttons are tabbable when visible', () => {
      renderChrome({ shell: { controlsVisible: true } })

      for (const button of screen.getAllByRole('button')) expect(button).toHaveAttribute('tabindex', '0')
      expect(slider()).toHaveAttribute('tabindex', '0')
    })

    it('buttons are not tabbable when hidden', () => {
      renderChrome({ shell: { controlsVisible: false } })

      for (const button of screen.getAllByRole('button')) expect(button).toHaveAttribute('tabindex', '-1')
      expect(slider()).toHaveAttribute('tabindex', '-1')
    })
  })

  describe('hover', () => {
    // A pointer over the bar keeps the shell from hiding it
    it('tells the shell when the mouse enters the controls', () => {
      const { shell } = renderChrome()

      fireEvent.mouseEnter(toolbar())

      expect(shell.setHoveringControls).toHaveBeenCalledTimes(1)
      expect(shell.setHoveringControls).toHaveBeenLastCalledWith(true)
    })

    it('tells the shell when the mouse leaves the controls', () => {
      const { shell } = renderChrome()

      fireEvent.mouseEnter(toolbar())
      fireEvent.mouseLeave(toolbar())

      expect(shell.setHoveringControls).toHaveBeenLastCalledWith(false)
    })
  })
})
