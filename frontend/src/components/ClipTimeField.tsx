import { useState } from 'react'

/** Commit typed times on blur/Enter so intermediate digits never fight the range clamp. */
export function ClipTimeField({ label, value, min, max, onCommit }: {
  label: string; value: number; min: number; max: number; onCommit: (value: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const clamp = (time: number) => Math.max(min, Math.min(max, time))
  function commit() {
    if (draft !== null && draft.trim() !== '' && Number.isFinite(Number(draft))) onCommit(clamp(Number(draft)))
    setDraft(null)
  }
  return <label className="flex flex-col gap-1 text-sm">{label}
    <input type="number" min={min} max={max} step={0.1} value={draft ?? value.toFixed(1)}
      onChange={e => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') { e.preventDefault(); setDraft(null) }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          const next = clamp(Math.round((value + (e.key === 'ArrowUp' ? 0.1 : -0.1)) * 10) / 10)
          setDraft(null); onCommit(next)
        }
      }} className="h-10 w-28 rounded-md border bg-background px-3 tabular-nums" />
  </label>
}
