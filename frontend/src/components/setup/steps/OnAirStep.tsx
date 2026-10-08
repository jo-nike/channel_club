import type { Ref } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowRight, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AppIcon } from '@/components/brand/AppIcon'
import { SMALL_BUTTON } from '@/components/server-settings/fields/styles'
import type { SetupFacts } from '@/types/setup'
import { StepHeading } from '../StepHeader'
import { onAirFacts } from '../summaries'

const LINK_ID = 'setup-club-link'

/** Select the link's text, for copying by hand when the clipboard won't take it. */
function selectLink() {
  const link = document.getElementById(LINK_ID)
  const selection = window.getSelection()
  if (!link || !selection) return
  const range = document.createRange()
  range.selectNodeContents(link)
  selection.removeAllRanges()
  selection.addRange(range)
}

interface OnAirStepProps {
  facts: SetupFacts | null
  headingRef: Ref<HTMLHeadingElement>
}

/** Setup is done: the club's link to send the group, what's on, and the way in. */
export function OnAirStep({ facts, headingRef }: OnAirStepProps) {
  const navigate = useNavigate()
  const link = window.location.origin
  const shown = facts ? onAirFacts(facts) : []

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link)
      toast.success('Copied')
    } catch {
      // No clipboard here (an http address, or a browser that asks): the text is ready to copy
      selectLink()
      toast('Link selected, ready to copy.')
    }
  }

  return (
    <div className="mx-auto mt-[3vh] flex w-full max-w-[560px] flex-col items-center gap-[18px] text-center">
      <div className="size-[116px] overflow-hidden rounded-[27px] shadow-[0_14px_34px_-12px_oklch(0_0_0/0.55)]">
        <AppIcon turnOn className="block size-full" />
      </div>
      <p className="inline-flex items-center gap-2 rounded-full bg-live/15 px-3 py-[5px] text-[12.5px] font-bold tracking-[0.12em] uppercase">
        <span className="size-2 animate-on-air-pulse rounded-full bg-live" aria-hidden="true" />
        On air
      </p>
      <StepHeading headingRef={headingRef} className="text-[44px] leading-none text-balance min-[760px]:text-[54px]">
        Channel Club is open
      </StepHeading>
      <p className="max-w-[58ch] text-base leading-[1.55] text-pretty text-muted-foreground">
        Send your group the link. On a TV, open it and choose Sign in with a code.
      </p>
      <div className="flex w-full max-w-[440px] items-center gap-2 rounded-[10px] border bg-card py-1.5 pr-1.5 pl-3.5">
        <span id={LINK_ID} className="min-w-0 flex-1 truncate text-left font-mono text-sm">
          {link}
        </span>
        <Button type="button" variant="outline" className={SMALL_BUTTON} onClick={() => void copyLink()}>
          <Copy aria-hidden="true" />
          Copy link
        </Button>
      </div>
      {shown.length > 0 && (
        <ul aria-label="What's on" className="m-0 flex list-none flex-wrap justify-center gap-2 p-0">
          {shown.map((fact) => (
            <li key={fact} className="rounded-full bg-muted px-3 py-[5px] text-[13px]">
              {fact}
            </li>
          ))}
        </ul>
      )}
      <Button type="button" className="h-12 px-6 text-base" onClick={() => void navigate('/', { replace: true })}>
        Start watching
        <ArrowRight aria-hidden="true" />
      </Button>
    </div>
  )
}
