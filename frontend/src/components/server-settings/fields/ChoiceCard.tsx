import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface ChoiceCardProps extends Omit<ComponentProps<'input'>, 'type' | 'title'> {
  title: ReactNode
  description: ReactNode
}

/**
 * One option of a pick-one choice, as a card: a native radio (with the global
 * focus outline) and the whole card to click. Give the options one name.
 */
export function ChoiceCard({ title, description, className, ...radio }: ChoiceCardProps) {
  return (
    <label
      className={cn(
        'relative flex cursor-pointer flex-col gap-1.5 rounded-xl border bg-card py-4 pr-4 pl-12 transition-[border-color,box-shadow] hover:border-primary/50 has-checked:border-primary has-checked:shadow-[0_0_0_1px_var(--color-primary)]',
        className
      )}
    >
      <input type="radio" className="absolute top-[19px] left-[17px] m-0 size-[18px] accent-primary" {...radio} />
      <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 font-semibold">{title}</span>
      <span className="text-sm text-muted-foreground">{description}</span>
    </label>
  )
}
