import { Fragment } from 'react'
import { Lock } from 'lucide-react'

/** "A", "A and B", "A, B and C", each as code. */
function nameList(names: readonly string[]) {
  return names.map((name, i) => (
    <Fragment key={name}>
      {i > 0 && (i === names.length - 1 ? ' and ' : ', ')}
      <code className="rounded-[5px] bg-info/15 px-1.5 py-px font-mono text-xs">{name}</code>
    </Fragment>
  ))
}

interface LockedNoteProps {
  /** The environment variables that set it */
  names: readonly string[]
  /** What is set, when the note isn't under the setting's own control ("Log level") */
  subject?: string
  id?: string
}

/** Why a setting can't be changed here: "Set by DISPATCHARR_URL in the server's environment." */
export function LockedNote({ names, subject, id }: LockedNoteProps) {
  return (
    <p id={id} className="flex items-start gap-[7px] text-[13px] leading-[1.45] text-info">
      <Lock className="mt-px size-4 shrink-0" aria-hidden="true" />
      <span>
        {subject ? `${subject} is set` : 'Set'} by {nameList(names)} in the server's environment.
      </span>
    </p>
  )
}
