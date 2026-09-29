import { LoaderCircle, Plug, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { TestCheck } from '../model/testResults'
import { CheckRow } from './CheckRow'
import { SMALL_BUTTON } from './styles'

interface TestConnectionProps {
  label?: string
  busyLabel?: string
  /** The label once a result shows */
  againLabel?: string
  icon?: LucideIcon
  small?: boolean
  running: boolean
  /** The result for the inputs shown now: empty before a test, and again once an input changes */
  checks: readonly TestCheck[]
  /** A request that failed before any verdict, for the inputs shown now */
  error?: string
  onTest: () => void
  /** For focusing the button, e.g. from an error about the test */
  id?: string
}

/**
 * A button that tests a connection and, under it, a status region that is
 * always there, so screen readers announce each result as it arrives.
 */
export function TestConnection({
  label = 'Test connection',
  busyLabel = 'Testing…',
  againLabel = 'Test again',
  icon = Plug,
  small = false,
  running,
  checks,
  error,
  onTest,
  id,
}: TestConnectionProps) {
  const done = !running && (checks.length > 0 || Boolean(error))
  const Icon = running ? LoaderCircle : icon

  return (
    <div className="flex flex-col items-start gap-3">
      <Button
        id={id}
        type="button"
        variant="outline"
        disabled={running}
        onClick={onTest}
        className={small ? SMALL_BUTTON : 'h-11 px-[18px] text-[15px] font-semibold'}
      >
        <Icon className={cn(small ? 'size-4' : 'size-[18px]', running && 'animate-spin')} aria-hidden="true" />
        {running ? busyLabel : done ? againLabel : label}
      </Button>
      <div role="status" aria-live="polite" className="flex w-full flex-col gap-2">
        {checks.map((check, i) => (
          <CheckRow key={`${check.title}-${i}`} check={check} delayMs={i * 110} />
        ))}
        {error && !running && <CheckRow check={{ tone: 'bad', title: error, detail: '' }} />}
      </div>
    </div>
  )
}
