import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SubsectionProps {
  title: ReactNode
  icon?: LucideIcon
  optional?: boolean
  help?: ReactNode
  className?: string
  children?: ReactNode
}

/** A titled group inside a card's body, such as Guest login; one after another is set off by a dashed rule. */
export function Subsection({ title, icon: Icon, optional, help, className, children }: SubsectionProps) {
  return (
    <div className={cn('flex flex-col gap-3 [&+&]:border-t [&+&]:border-dashed [&+&]:pt-[18px]', className)}>
      {/* Under the card's h2; set in the sans face, not the display face headings get */}
      <h3 className="flex items-center gap-2 font-sans text-[14.5px] font-semibold">
        {Icon && <Icon className="size-4 shrink-0" aria-hidden="true" />}
        {title}
        {optional && (
          <>
            {' '}
            <span className="text-[13px] font-normal text-muted-foreground">optional</span>
          </>
        )}
      </h3>
      {help && <p className="text-[13px] leading-[1.45] text-pretty text-muted-foreground">{help}</p>}
      {children}
    </div>
  )
}
