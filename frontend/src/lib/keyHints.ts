/**
 * A control's tooltip with its keyboard shortcut, 'Mute (M)', so the keys can
 * be found without the '?' sheet. The button's accessible name stays the
 * action alone; its aria-keyshortcuts carries the key for assistive technology.
 */
export function withKey(label: string, key: string): string {
  return `${label} (${key})`
}
