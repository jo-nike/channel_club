/**
 * TV remote key map. Turns a keydown from a webOS or Tizen remote (or a
 * desktop keyboard in TV mode) into the few actions the TV view handles.
 *
 * Older TV browsers (webOS 3 ships Chrome 38) predate KeyboardEvent.key, and
 * some remote buttons arrive with key 'Unidentified', so every action also
 * matches its legacy keyCode.
 */

export type RemoteAction = 'channelUp' | 'channelDown' | 'back' | 'ok'

// webOS sends CH+/CH- as PageUp/PageDown (33/34)
const CHANNEL_UP_KEYS = new Set(['ArrowUp', 'PageUp', 'ChannelUp'])
const CHANNEL_UP_CODES = new Set([38, 33])
const CHANNEL_DOWN_KEYS = new Set(['ArrowDown', 'PageDown', 'ChannelDown'])
const CHANNEL_DOWN_CODES = new Set([40, 34])
const BACK_KEYS = new Set(['Escape', 'Backspace', 'GoBack', 'BrowserBack'])
// 27 Escape, 8 Backspace, 461 webOS Back, 10009 Tizen Return
const BACK_CODES = new Set([27, 8, 461, 10009])

export function getRemoteAction(e: Pick<KeyboardEvent, 'key' | 'keyCode'>): RemoteAction | null {
  if (CHANNEL_UP_KEYS.has(e.key) || CHANNEL_UP_CODES.has(e.keyCode)) return 'channelUp'
  if (CHANNEL_DOWN_KEYS.has(e.key) || CHANNEL_DOWN_CODES.has(e.keyCode)) return 'channelDown'
  if (BACK_KEYS.has(e.key) || BACK_CODES.has(e.keyCode)) return 'back'
  if (e.key === 'Enter' || e.keyCode === 13) return 'ok'
  return null
}
