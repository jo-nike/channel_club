import { useEffect, useState } from 'react'

const SLOTS = 10
// Seeks in a fresh remote capture can be slow; 3s left production strips blank.
const TIMEOUT_MS = 8000
const EMPTY: (string | null)[] = Array(SLOTS).fill(null)

export interface ClipThumbnails {
  /** One entry per fixed slot; null until that frame is drawn, or for good if its seek failed. */
  frames: (string | null)[]
  loading: boolean
}

/**
 * Filmstrip frames from a separate decoder, so generation never moves the visible preview.
 * Each slot is filled as soon as its frame is drawn; a slow seek leaves its slot empty and the rest continue.
 */
export function useClipThumbnails(url: string, duration: number): ClipThumbnails {
  const key = `${url}#${duration}`
  const [state, setState] = useState<ClipThumbnails & { key: string }>({ key, frames: EMPTY, loading: true })

  useEffect(() => {
    const controller = new AbortController()
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'auto'
    const update = (change: (current: ClipThumbnails) => ClipThumbnails) => {
      if (controller.signal.aborted) return
      setState(previous => ({ key, ...change(previous.key === key ? previous : { frames: EMPTY, loading: true }) }))
    }
    const wait = (event: string) => new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer)
        video.removeEventListener(event, ready)
        video.removeEventListener('error', failed)
        controller.signal.removeEventListener('abort', failed)
        if (error) reject(error); else resolve()
      }
      const ready = () => finish()
      const failed = () => finish(new Error('Thumbnail unavailable'))
      const timer = setTimeout(failed, TIMEOUT_MS)
      video.addEventListener(event, ready, { once: true })
      video.addEventListener('error', failed, { once: true })
      controller.signal.addEventListener('abort', failed, { once: true })
    })
    const generate = async () => {
      try {
        const loaded = wait('loadeddata')
        video.src = url
        await loaded
        const canvas = document.createElement('canvas')
        canvas.width = 160; canvas.height = 90
        const context = canvas.getContext('2d')
        if (!context) return
        for (let i = 0; i < SLOTS; i++) {
          const sought = wait('seeked')
          video.currentTime = Math.min(duration - 0.01, (i + 0.5) * duration / SLOTS)
          try { await sought } catch {
            // A broken decoder or a closed editor ends the strip; a slow seek only skips this slot.
            if (controller.signal.aborted || video.error) return
            continue
          }
          context.drawImage(video, 0, 0, 160, 90)
          const frame = canvas.toDataURL('image/jpeg', 0.65)
          update(current => ({ ...current, frames: current.frames.map((src, slot) => slot === i ? frame : src) }))
        }
      } catch { /* The timeline works without thumbnails. */ } finally {
        update(current => ({ ...current, loading: false }))
      }
    }
    void generate()
    return () => { controller.abort(); video.removeAttribute('src'); video.load() }
  }, [key, url, duration])

  return state.key === key ? { frames: state.frames, loading: state.loading } : { frames: EMPTY, loading: true }
}
