import { CircleCheck, CircleDashed } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MIN_PASSWORD_LENGTH, passwordLength } from '../model/validation'

/** The two rules a new password meets, each ticked off as it is met. */
export function PasswordRules({ password, confirm }: { password: string; confirm: string }) {
  const rules = [
    { text: `At least ${MIN_PASSWORD_LENGTH} characters`, met: passwordLength(password) >= MIN_PASSWORD_LENGTH },
    { text: 'Both passwords match', met: password !== '' && password === confirm },
  ]

  return (
    <ul aria-label="Password rules" className="m-0 flex list-none flex-wrap gap-x-5 gap-y-1.5 p-0 text-[13px] text-muted-foreground">
      {rules.map((rule) => {
        const Icon = rule.met ? CircleCheck : CircleDashed
        return (
          <li key={rule.text} data-met={rule.met} className={cn('flex items-center gap-1.5', rule.met && 'text-success')}>
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            {rule.text}
            <span className="sr-only">{rule.met ? ', met' : ', not met yet'}</span>
          </li>
        )
      })}
    </ul>
  )
}
