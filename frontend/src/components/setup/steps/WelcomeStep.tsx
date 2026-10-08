import type { Ref } from 'react'
import { Lock, SatelliteDish, Sparkles, Users } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { AppIcon } from '@/components/brand/AppIcon'
import { Wordmark } from '@/components/brand/Wordmark'
import { Callout } from '@/components/server-settings/fields/Callout'
import { Chip } from '@/components/server-settings/fields/Chip'
import { APP_TAGLINE } from '@/lib/appInfo'
import type { EnvLock } from '@/types/setup'
import { StepHeading } from '../StepHeader'

const NEEDS = [
  {
    icon: SatelliteDish,
    title: 'Where your channels come from',
    description: 'The address of Dispatcharr, ErsatzTV or both. For Dispatcharr, an API key from your profile page too.',
  },
  {
    icon: Users,
    title: 'How your group signs in',
    description: "Your Plex account if the group uses Plex. If not, you'll make a username and password.",
  },
  {
    icon: Sparkles,
    title: 'Extras, if you want them',
    description: 'A GIPHY key for GIFs in chat, a Zipline server for sharing clips, an ntfy topic for feedback.',
  },
]

interface WelcomeStepProps {
  /** The variables this server's environment sets */
  envLocked: readonly EnvLock[]
  headingRef: Ref<HTMLHeadingElement>
}

/** What Channel Club is, what setup needs, and what the environment already sets. */
export function WelcomeStep({ envLocked, headingRef }: WelcomeStepProps) {
  const count = envLocked.length

  return (
    <>
      <div className="flex flex-col items-start gap-3.5">
        <AppIcon className="size-16 rounded-[15px] shadow-[0_8px_20px_-8px_oklch(0_0_0/0.5)]" />
        <StepHeading headingRef={headingRef} className="mt-1.5">
          <span className="sr-only">Welcome to</span>{' '}
          <Wordmark size="lg" className="gap-[0.22em] text-[clamp(40px,8.5cqi,66px)] [&>[data-slot=wordmark-dot]]:size-[0.22em]" />
        </StepHeading>
        <p className="text-lg font-medium text-muted-foreground">{APP_TAGLINE}</p>
        <p className="max-w-[58ch] text-base leading-[1.55] text-pretty text-muted-foreground">
          Channel Club puts your group on the same live channel, with a guide and a chat beside the player. Setup takes about five
          minutes, and you can change any of it later from the Admin panel.
        </p>
      </div>

      {count > 0 && (
        <Callout tone="info" icon={Lock}>
          <p>
            <strong>
              {count} {count === 1 ? 'setting comes' : 'settings come'} from this server's environment.
            </strong>{' '}
            They show as locked during setup. To manage one here instead, remove it from the environment and restart.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {envLocked.map((lock) => (
              <Chip key={lock.env} tone="env">
                {lock.env}
              </Chip>
            ))}
          </div>
        </Callout>
      )}

      <Card className="gap-0 py-0">
        <div className="flex flex-col gap-[3px] px-5 py-[18px] max-[760px]:px-4">
          {/* A card title, not a display heading: the base rule would set it in the display face */}
          <h2 className="font-sans text-base leading-[1.35] font-semibold">Before you start</h2>
          <p className="text-sm text-muted-foreground">Have these to hand.</p>
        </div>
        <ul className="m-0 list-none border-t p-0">
          {NEEDS.map(({ icon: Icon, title, description }) => (
            <li key={title} className="flex gap-3.5 border-t px-5 py-3.5 first:border-t-0 max-[760px]:px-4">
              <Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <p className="font-semibold">{title}</p>
                <p className="text-sm text-muted-foreground">{description}</p>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </>
  )
}
