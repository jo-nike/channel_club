import { cn } from '@/lib/utils'
import { MEMBER_COLOR_CLASS, memberColorStyle, memberKey } from '@/lib/memberColor'

export interface MemberAvatarProps {
  // Display name: the initials come from it and it is the accessible name
  username: string
  // Stable id the colour hangs on; without it the name picks the colour
  userId?: string
  // md is 24px (chat, lists); sm is 20px (facepiles), with one initial since
  // two don't fit at the 11px text minimum
  size?: 'md' | 'sm'
  // Hide it from assistive tech when the name is already written beside it
  decorative?: boolean
  className?: string
}

const SIZE_CLASSES = {
  md: 'size-6 text-[11px]',
  sm: 'size-5 text-[11px]',
} as const

/**
 * Up to `max` initials: the first letters of the first words ("Sam Lee" is
 * SL, "jon_smith" is JS, "maya" is M).
 */
function memberInitials(name: string, max: number): string {
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? []
  if (words.length === 0) return Array.from(name.trim())[0] ?? '?'
  return words
    .slice(0, max)
    .map((word) => Array.from(word)[0])
    .join('')
    .toUpperCase()
}

/** A member's initials on a disc in their member colour. */
export function MemberAvatar({ username, userId, size = 'md', decorative = false, className }: MemberAvatarProps) {
  return (
    <span
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': username })}
      style={memberColorStyle(memberKey({ userId, username }))}
      className={cn(
        MEMBER_COLOR_CLASS,
        'inline-grid shrink-0 select-none place-items-center rounded-full bg-(--member) font-bold leading-none text-(--member-ink)',
        SIZE_CLASSES[size],
        className
      )}
    >
      {memberInitials(username, size === 'sm' ? 1 : 2)}
    </span>
  )
}
