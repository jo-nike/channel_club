import { useSyncExternalStore } from 'react'

// All programme consumers share one clock, active only while subscribed.
let now = Date.now()
let timer: ReturnType<typeof setInterval> | undefined
const listeners = new Set<() => void>()
function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!timer) {
    now = Date.now()
    timer = setInterval(() => {
      now = Date.now()
      listeners.forEach((notify) => notify())
    }, 30_000)
  }
  return () => {
    listeners.delete(listener)
    if (!listeners.size) { clearInterval(timer); timer = undefined }
  }
}
export function useProgrammeClock() {
  return useSyncExternalStore(subscribe, () => now)
}
