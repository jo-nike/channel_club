import type { EnvVariable } from '@/types/setup'
import { Chip } from '../fields/Chip'

/** The variables the server's environment sets, each with its value; a secret only says it is set. */
export function EnvironmentList({ environment }: { environment: readonly EnvVariable[] }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {environment.map((variable) => (
        <li key={variable.env} className="flex flex-wrap items-center gap-2.5 text-sm">
          <Chip tone="env">{variable.env}</Chip>
          <span className="font-mono text-[13px] [overflow-wrap:anywhere] text-muted-foreground">
            {variable.secret ? 'set, hidden' : variable.value === '' || variable.value === null ? '(empty)' : variable.value}
          </span>
        </li>
      ))}
    </ul>
  )
}
