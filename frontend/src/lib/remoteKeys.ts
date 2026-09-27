/**
 * TV remote key map. Turns a keydown from a webOS or Tizen remote (or a
 * desktop keyboard in TV mode) into the few actions the TV view handles.
 *
 * Older TV browsers (webOS 3 ships Chrome 38) predate KeyboardEvent.key, and
 * some remote buttons arrive with key 'Unidentified', so every action also
 * matches its legacy keyCode.
 */

export type RemoteAction = 'channelUp' | 'channelDown' | 'back' | 'ok' | 'digit' | 'playPause'

// webOS sends CH+/CH- as PageUp/PageDown (33/34)
const CHANNEL_UP_KEYS = new Set(['ArrowUp', 'PageUp', 'ChannelUp'])
const CHANNEL_UP_CODES = new Set([38, 33])
const CHANNEL_DOWN_KEYS = new Set(['ArrowDown', 'PageDown', 'ChannelDown'])
const CHANNEL_DOWN_CODES = new Set([40, 34])
const BACK_KEYS = new Set(['Escape', 'Backspace', 'GoBack', 'BrowserBack'])
// 27 Escape, 8 Backspace, 461 webOS Back, 10009 Tizen Return
const BACK_CODES = new Set([27, 8, 461, 10009])
// 179 MediaPlayPause, 10252 Tizen MediaPlayPause
const PLAY_PAUSE_CODES = new Set([179, 10252])

/**
 * The digit ('0'-'9') a keydown types, or null: the number row and the
 * number pad, which a remote's number keys arrive as. By keyCode only when
 * the key has no name, since Shift+1 ('!') shares the 1 key's code.
 */
export function getRemoteDigit(e: Pick<KeyboardEvent, 'key' | 'keyCode'>): string | null {
  if (/^[0-9]$/.test(e.key)) return e.key
  if (e.key && e.key !== 'Unidentified') return null
  if (e.keyCode >= 48 && e.keyCode <= 57) return String(e.keyCode - 48)
  if (e.keyCode >= 96 && e.keyCode <= 105) return String(e.keyCode - 96)
  return null
}

export function getRemoteAction(e: Pick<KeyboardEvent, 'key' | 'keyCode'>): RemoteAction | null {
  if (CHANNEL_UP_KEYS.has(e.key) || CHANNEL_UP_CODES.has(e.keyCode)) return 'channelUp'
  if (CHANNEL_DOWN_KEYS.has(e.key) || CHANNEL_DOWN_CODES.has(e.keyCode)) return 'channelDown'
  if (BACK_KEYS.has(e.key) || BACK_CODES.has(e.keyCode)) return 'back'
  if (e.key === 'Enter' || e.keyCode === 13) return 'ok'
  if (e.key === 'MediaPlayPause' || PLAY_PAUSE_CODES.has(e.keyCode)) return 'playPause'
  if (getRemoteDigit(e) !== null) return 'digit'
  return null
}

// Focus here keeps its keys: text entry, sliders, and open dialogs, menus and lists
const FOCUSED_CONTROL_SELECTOR =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [role="menu"], [role="listbox"], [role="slider"]'

/**
 * True when a keydown belongs to the focused control rather than to the TV
 * view, or carries a modifier (Ctrl+PageUp switches browser tabs).
 */
export function isKeyForFocusedControl(
  e: Pick<KeyboardEvent, 'target' | 'altKey' | 'ctrlKey' | 'metaKey'>
): boolean {
  if (e.altKey || e.ctrlKey || e.metaKey) return true
  return e.target instanceof Element && e.target.closest(FOCUSED_CONTROL_SELECTOR) !== null
}
