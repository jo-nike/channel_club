import type { ReactNode } from 'react'
import { Eye, House, KeyRound, Lock, Tv, Users } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { PlexMember, PlexRole } from '@/types/setup'
import { fieldValue, lockedBy, secretEntry } from '../model/configDraft'
import { Field, FieldMessage } from '../fields/Field'
import { PeopleAdminList } from '../fields/PeopleAdminList'
import { SecretField } from '../fields/SecretField'
import { SegmentedRadio } from '../fields/SegmentedRadio'
import { SettingCard } from '../fields/SettingCard'
import { Subsection } from '../fields/Subsection'
import { ToggleRow } from '../fields/ToggleRow'
import { INPUT, LOCKED_INPUT, SCROLL_MARGIN } from '../fields/styles'
import type { SectionProps } from './types'

const ROLES = [
  { value: 'viewer', label: 'Viewer' },
  { value: 'admin', label: 'Admin' },
] as const satisfies readonly { value: PlexRole; label: string }[]

const HELP = 'text-[13px] leading-[1.45] text-pretty text-muted-foreground'

interface AccessSectionProps extends SectionProps {
  /** How the admin at the screen signs in: that sign-in stays on */
  adminSignIn: 'plex' | 'password'
  /** The Plex id of the admin at the screen, marked You among the members */
  selfPlexId?: string | null
  /** The linked server's members: 'loading' while they load, 'failed' when plex.tv wouldn't list them */
  members: readonly PlexMember[] | 'loading' | 'failed'
  /**
   * Shown while Plex members are on and no server is linked: signing in to
   * Plex and picking the server. Give its button the id `${idPrefix}-plex-link`.
   */
  plexConnect?: ReactNode
  /** Leave out the house rules (the Admin panel's People tab has them) */
  showHouseRules?: boolean
}

function StaysOn({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
      <Lock className="size-4 shrink-0" aria-hidden="true" />
      {children}
    </p>
  )
}

/** Who can join: Plex members, username and password logins, and the house rules. */
export function AccessSection({
  state,
  errors,
  onField,
  idPrefix,
  adminSignIn,
  selfPlexId,
  members,
  plexConnect,
  showHouseRules = true,
}: AccessSectionProps) {
  const { view } = state
  const plexOn = fieldValue(state, 'plexAuthEnabled')
  const localOn = fieldValue(state, 'localAuthEnabled')
  const linked = Boolean(view.values.plexServerMachineId)
  const serverName = view.plexServerName ?? 'your Plex server'
  const role = fieldValue(state, 'plexDefaultRole')

  const username = (field: 'adminUsername' | 'viewerUsername') => {
    const lock = lockedBy(view, field)
    return (
      <Field id={`${idPrefix}-${field}`} label="Username" error={errors[field]} lockedBy={lock}>
        {(control) => (
          <Input
            {...control}
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={fieldValue(state, field)}
            readOnly={lock !== null}
            onChange={(event) => onField(field, event.target.value)}
            className={cn(INPUT, SCROLL_MARGIN, lock && LOCKED_INPUT)}
          />
        )}
      </Field>
    )
  }

  const password = (field: 'adminPassword' | 'viewerPassword') => (
    <SecretField
      id={`${idPrefix}-${field}`}
      label="Password"
      noun={field === 'adminPassword' ? 'admin password' : 'guest password'}
      kind="password"
      entry={secretEntry(state, field)}
      onChange={(value) => onField(field, value)}
      error={errors[field]}
      lockedBy={lockedBy(view, field)}
    />
  )

  return (
    <>
      <SettingCard
        id={`${idPrefix}-card-plex`}
        icon={Users}
        title="Plex members"
        description={`Everyone you share ${serverName} with can sign in with their Plex account.`}
        toggle={{
          id: `${idPrefix}-plexAuthEnabled`,
          checked: plexOn,
          onChange: (on) => onField('plexAuthEnabled', on),
          disabled: adminSignIn === 'plex' || lockedBy(view, 'plexAuthEnabled') !== null,
        }}
      >
        {adminSignIn === 'plex' && <StaysOn>You sign in with Plex, so this stays on.</StaysOn>}
        {linked ? (
          <>
            <div className="flex flex-col gap-[7px]">
              <span id={`${idPrefix}-role-label`} className="text-sm font-semibold">
                New members join as
              </span>
              <SegmentedRadio
                name={`${idPrefix}-plexDefaultRole`}
                value={role}
                options={ROLES}
                onChange={(value) => onField('plexDefaultRole', value)}
                labelledBy={`${idPrefix}-role-label`}
                disabled={lockedBy(view, 'plexDefaultRole') !== null}
              />
              <p className={HELP}>Viewers watch, chat and make clips. Admins also set the live channel for everyone and change settings.</p>
              {role === 'admin' && (
                <FieldMessage tone="warning">
                  Every member of {serverName} will be an admin, including people you share it with later.
                </FieldMessage>
              )}
            </div>
            <div className="flex flex-col gap-[7px]">
              <span id={`${idPrefix}-admins-label`} className="text-sm font-semibold">
                Admins
              </span>
              {members === 'loading' ? (
                <p className={HELP}>Loading the server's members…</p>
              ) : members === 'failed' ? (
                <FieldMessage tone="warning">
                  Couldn't load the server's members. The admins stay as they are; change them later in the Admin panel.
                </FieldMessage>
              ) : (
                <PeopleAdminList
                  members={members}
                  adminIds={fieldValue(state, 'plexAdminIds')}
                  onChange={(ids) => onField('plexAdminIds', ids)}
                  labelledBy={`${idPrefix}-admins-label`}
                  selfId={selfPlexId}
                />
              )}
              {errors.plexAdminIds && <FieldMessage tone="error">{errors.plexAdminIds}</FieldMessage>}
              <p className={HELP}>People you add to the server later join as viewers until you make them admins.</p>
            </div>
          </>
        ) : (
          <>
            {plexConnect}
            {errors.plexLink && (
              <FieldMessage id={`${idPrefix}-plexLink-err`} tone="error">
                {errors.plexLink}
              </FieldMessage>
            )}
          </>
        )}
      </SettingCard>

      <SettingCard
        id={`${idPrefix}-card-local`}
        icon={KeyRound}
        title="Username and password"
        description="For people without Plex, and a way in when plex.tv is down."
        toggle={{
          id: `${idPrefix}-localAuthEnabled`,
          checked: localOn,
          onChange: (on) => onField('localAuthEnabled', on),
          disabled: adminSignIn === 'password' || lockedBy(view, 'localAuthEnabled') !== null,
        }}
      >
        {adminSignIn === 'password' ? (
          <>
            <StaysOn>You sign in with a password, so this stays on.</StaysOn>
            <Subsection title="Admin login" help={`${view.values.adminUsername}, the account you sign in with.`} />
          </>
        ) : (
          <Subsection title="Admin login" optional help="A fallback for you when plex.tv is down. Without a password there is none.">
            <div className="grid grid-cols-2 gap-4 max-[760px]:grid-cols-1">
              {username('adminUsername')}
              {password('adminPassword')}
            </div>
          </Subsection>
        )}
        <Subsection
          title="Guest login"
          optional
          help="One shared login for people without Plex, like the living-room TV. Guests join as viewers. Without a password there is no guest login."
        >
          <div className="grid grid-cols-2 gap-4 max-[760px]:grid-cols-1">
            {username('viewerUsername')}
            {password('viewerPassword')}
          </div>
        </Subsection>
      </SettingCard>

      {showHouseRules && (
        <SettingCard
          id={`${idPrefix}-card-rules`}
          icon={House}
          title="House rules"
          description="How the shared channel and presence work for everyone."
        >
          <ToggleRow
            id={`${idPrefix}-userChannelSelection`}
            icon={Tv}
            title="Anyone can change the live channel"
            description="Let any signed-in person pick the channel everyone watches. Clearing it stays admin-only."
            checked={fieldValue(state, 'userChannelSelection')}
            onChange={(on) => onField('userChannelSelection', on)}
          />
          <ToggleRow
            id={`${idPrefix}-presenceVisible`}
            icon={Eye}
            title="Show what everyone is watching"
            description="Ask the group first. While it's off, people see only who is online. Viewing is recorded for your stats either way."
            checked={fieldValue(state, 'presenceVisible')}
            onChange={(on) => onField('presenceVisible', on)}
          />
        </SettingCard>
      )}
    </>
  )
}
