import { CircleCheck, CircleX } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TestCheck } from '../model/testResults'

/** One line of a test's outcome; rows after the first rise in a little later. */
export function CheckRow({ check, delayMs = 0 }: { check: TestCheck; delayMs?: number }) {
  const Icon = check.tone === 'ok' ? CircleCheck : CircleX
  return (
    <div
      data-tone={check.tone}
      className="flex items-start gap-2.5 rounded-[9px] bg-muted/55 px-3 py-2.5 animate-in fade-in slide-in-from-bottom-1 fill-mode-both duration-300"
      style={delayMs ? { animationDelay: `${delayMs}ms` } : undefined}
    >
      <Icon
        className={cn('mt-px size-[18px] shrink-0', check.tone === 'ok' ? 'text-success' : 'text-destructive')}
        aria-hidden="true"
      />
      <div className="min-w-0">
        <p className="text-sm font-semibold">{check.title}</p>
        {check.detail && <p className="text-[13px] [overflow-wrap:anywhere] text-muted-foreground">{check.detail}</p>}
      </div>
    </div>
  )
}
