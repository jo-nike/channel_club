import { useId } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useChatEnabled } from '@/hooks/useChatEnabled'
import { useReturnFocus } from '@/hooks/useReturnFocus'

interface ShortcutSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The player shell, so the sheet shows in fullscreen too */
  container: HTMLElement | null
  /** Whether '/' has a channel search to focus here */
  canSearch?: boolean
  /** Whether X has Clip that to run here (never on a TV) */
  canClip?: boolean
  /** Whether C opens the composer over the video here rather than the chat
   * panel (theater or fullscreen with 'Show chat over the video' on, on a
   * fine pointer; see useChatOverlayMode) */
  canReply?: boolean
  /** The 10-foot TV layout (useTVMode), where ↑/↓ change channel, OK opens
   * the guide and there is no chat or theater mode (see CouchView) */
  tvMode?: boolean
}

interface Shortcut {
  /** Each alternative is one key or a pair (up/down) */
  keys: string[][]
  action: string
}

interface ShortcutGroup {
  title: string
  shortcuts: Shortcut[]
}

// The map useVideoKeyboardShortcuts implements, and on a TV CouchView's remote
// keys. Letters are shown in capitals, as on the keycaps; they work either way.
const player = (canClip: boolean, tvMode: boolean): ShortcutGroup => ({
  title: 'Player',
  shortcuts: [
    { keys: [['Space']], action: 'Play or pause' },
    { keys: [['M']], action: 'Mute or unmute' },
    { keys: tvMode ? [['→', '←']] : [['↑', '↓'], ['→', '←']], action: 'Volume up or down' },
    { keys: [['F']], action: 'Fullscreen' },
    ...(tvMode ? [] : [{ keys: [['T']], action: 'Theater mode' }]),
    { keys: [['R']], action: 'Reload the stream' },
    ...(canClip ? [{ keys: [['X']], action: 'Clip that: post the last 20s to chat' }] : []),
  ],
})

const channels = (canSearch: boolean, tvMode: boolean): ShortcutGroup => ({
  title: 'Channels',
  shortcuts: [
    {
      keys: tvMode ? [['↑', '↓'], ['PgUp', 'PgDn'], [']', '[']] : [['PgUp', 'PgDn'], [']', '[']],
      action: 'Channel up or down',
    },
    { keys: [['0–9']], action: 'Type a channel number' },
    { keys: tvMode ? [['OK'], ['Enter']] : [['Enter']], action: 'Tune the number now' },
    { keys: [['L']], action: 'Last channel' },
    ...(canSearch ? [{ keys: [['/']], action: 'Search channels' }] : []),
  ],
})

// No chat on the TV layout, so no C there
const panels = (chatEnabled: boolean, canReply: boolean, tvMode: boolean): ShortcutGroup => ({
  title: 'Panels',
  shortcuts: [
    ...(chatEnabled && !tvMode
      ? [{ keys: [['C']], action: canReply ? 'Write in the chat over the video' : 'Open or close chat' }]
      : []),
    ...(tvMode
      ? [
          { keys: [['OK'], ['Guide']], action: 'Guide' },
          { keys: [['Green'], ['W']], action: "Who's here" },
        ]
      : []),
    // No NHL scores on the TV layout
    ...(tvMode ? [] : [{ keys: [['N']], action: 'NHL scores' }]),
    { keys: [['?']], action: 'This list' },
    { keys: [['Esc']], action: 'Close' },
  ],
})

/**
 * The player's keyboard map, opened with '?'. A dialog portalled into the
 * player shell, so it shows in fullscreen, where anything on the page is
 * hidden behind the shell.
 */
export function ShortcutSheet({
  open,
  onOpenChange,
  container,
  canSearch = false,
  canClip = false,
  canReply = false,
  tvMode = false,
}: ShortcutSheetProps) {
  const id = useId()
  const chatEnabled = useChatEnabled()
  const groups = [player(canClip, tvMode), channels(canSearch, tvMode), panels(chatEnabled, canReply, tvMode)]
  // A key opens the sheet, not a trigger Radix could return focus to: go back
  // to whatever had focus (a channel button just clicked), or the page
  const returnFocus = useReturnFocus()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        container={container}
        className="max-h-[85dvh] max-w-[min(40rem,calc(100%-2rem))] overflow-y-auto"
        // Keys pressed in the sheet stay in it: Escape closes the sheet only,
        // not the NHL scores too, whose Escape listener is on the document
        onKeyDown={(event) => event.stopPropagation()}
        {...returnFocus}
      >
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>They work while you watch, except when you are typing.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 sm:grid-cols-2">
          {groups.map((group) => (
            <section key={group.title} aria-labelledby={`${id}-${group.title}`}>
              <h3 id={`${id}-${group.title}`} className="mb-2 text-sm font-semibold text-muted-foreground">
                {group.title}
              </h3>
              <dl className="grid gap-2">
                {group.shortcuts.map((shortcut) => (
                  <div key={shortcut.action} className="flex items-center justify-between gap-4">
                    <dt className="text-sm">{shortcut.action}</dt>
                    <dd className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                      {shortcut.keys.map((alternative, i) => (
                        <span key={alternative.join(' ')} className="flex items-center gap-1">
                          {i > 0 && <span>or</span>}
                          {alternative.map((key) => (
                            <kbd
                              key={key}
                              className="min-w-6 rounded border border-b-2 border-border bg-muted px-1.5 py-0.5 text-center font-mono text-xs font-semibold text-foreground"
                            >
                              {key}
                            </kbd>
                          ))}
                        </span>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
