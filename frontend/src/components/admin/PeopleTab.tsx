import { ActiveUsersTab } from './ActiveUsersTab'
import { UserAccessTab } from './UserAccessTab'

/**
 * Who is here and what they may do: the active users (one row per person)
 * above the user access settings, in one admin tab.
 */
export function PeopleTab() {
  return (
    <div className="divide-y">
      <ActiveUsersTab />
      <UserAccessTab />
    </div>
  )
}
