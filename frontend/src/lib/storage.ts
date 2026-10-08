/*
 * JSON in localStorage or sessionStorage. Storage can be blocked (a private
 * window, a browser setting), and even naming it can throw, so the storage
 * comes as a getter and every read and write may fail quietly.
 */

/** The stored value, or null when there is none, it doesn't parse, or storage is blocked. */
export function readStored(storage: () => Storage, key: string): unknown {
  try {
    const text = storage().getItem(key)
    return text === null ? null : JSON.parse(text)
  } catch {
    return null
  }
}

export function writeStored(storage: () => Storage, key: string, value: unknown): void {
  try {
    storage().setItem(key, JSON.stringify(value))
  } catch {
    // Storage blocked or full: whatever it was for just won't resume
  }
}

export function removeStored(storage: () => Storage, key: string): void {
  try {
    storage().removeItem(key)
  } catch {
    // Storage blocked: nothing was stored
  }
}
