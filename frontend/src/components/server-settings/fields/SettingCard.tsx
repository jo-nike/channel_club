import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { SWITCH_HIT_AREA } from './styles'

interface SettingCardProps {
  /** Base for the ids: `${id}-title`, `${id}-desc` and `${id}-body` */
  id: string
  icon: LucideIcon
  title: ReactNode
  /** Beside the title, such as an "FFmpeg ready" chip */
  badge?: ReactNode
  description?: ReactNode
  /** A switch in the head that shows the body while on; its id defaults to `${id}-switch` */
  toggle?: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; id?: string }
  className?: string
  children?: ReactNode
}

/**
 * A card for one feature: icon, title (h2), description and an optional
 * switch in the head, with a body under it that shows only while the switch
 * is on. The switch is named by the title and described by the description.
 */
export function SettingCard({ id, icon: Icon, title, badge, description, toggle, className, children }: SettingCardProps) {
  const titleId = `${id}-title`
  const descId = description ? `${id}-desc` : undefined
  const bodyShown = children != null && (toggle === undefined || toggle.checked)

  return (
    <Card data-setting-card={id} className={cn('gap-0 py-0', className)}>
      <div className="flex items-start gap-3.5 px-5 py-[18px] max-[760px]:px-4">
        <Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          {/* A card title, not a display heading: the base rule would set it in the display face */}
          <h2 className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 font-sans text-base leading-[1.35] font-semibold">
            <span id={titleId}>{title}</span>
            {badge && (
              <>
                {' '}
                {badge}
              </>
            )}
          </h2>
          {description && (
            <p id={descId} className="text-sm text-pretty text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {toggle && (
          <Switch
            id={toggle.id ?? `${id}-switch`}
            checked={toggle.checked}
            onCheckedChange={toggle.onChange}
            disabled={toggle.disabled}
            aria-labelledby={titleId}
            aria-describedby={descId}
            aria-controls={bodyShown ? `${id}-body` : undefined}
            className={cn('mt-px', SWITCH_HIT_AREA)}
          />
        )}
      </div>
      {bodyShown && (
        <div id={`${id}-body`} className="flex flex-col gap-[18px] border-t px-5 pt-[18px] pb-5 max-[760px]:px-4">
          {children}
        </div>
      )}
    </Card>
  )
}
