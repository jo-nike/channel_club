import type { ReactNode } from 'react'
import { Check, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PlexSignInPanel } from '@/components/server-settings/PlexSignInPanel'
import { Callout } from '@/components/server-settings/fields/Callout'
import { FieldMessage } from '@/components/server-settings/fields/Field'
import { CardHeadingLevel } from '@/components/server-settings/fields/headingLevel'
import { SMALL_BUTTON } from '@/components/server-settings/fields/styles'
import {
  lockedBy,
  sectionPatch,
  SOURCE_KINDS,
  SOURCE_URL,
  sourceOn,
  type SettingsState,
} from '@/components/server-settings/model/configDraft'
import type { SectionId } from '@/components/server-settings/model/fields'
import { AccessSection } from '@/components/server-settings/sections/AccessSection'
import { AdvancedSection } from '@/components/server-settings/sections/AdvancedSection'
import { ExtrasSection } from '@/components/server-settings/sections/ExtrasSection'
import { SourcesSection } from '@/components/server-settings/sections/SourcesSection'
import { errorTargetId } from '@/components/server-settings/sections/types'
import { decodeTokenPayload } from '@/lib/jwt'
import { useAuthStore } from '@/stores/authStore'
import { RELINK_BUTTON_ID, SERVER_ID_PREFIX, useServerSettings, type ServerSettingsApi } from './useServerSettings'

const HELP = 'text-[13px] leading-[1.45] text-pretty text-muted-foreground'

const SECTION_COPY: Record<SectionId, { title: string; saveName: string }> = {
  sources: { title: 'Channels', saveName: 'channels' },
  access: { title: 'Who can join', saveName: 'who can join' },
  extras: { title: 'Extras', saveName: 'extras' },
  advanced: { title: 'Advanced', saveName: 'advanced settings' },
}

/**
 * Whether a section has changes to save, or to check: a setting a save would
 * send, or a source switched on or off (the server keeps only its address, so
 * one switched on with none yet sends nothing, but is checked).
 */
function hasChanges(settings: SettingsState, section: SectionId): boolean {
  if (sectionPatch(settings, section) !== null) return true
  return section === 'sources' && SOURCE_KINDS.some((kind) => sourceOn(settings, kind) !== (settings.view.values[SOURCE_URL[kind]] !== ''))
}

/**
 * One section of the tab, saved on its own: its heading, its settings, and a
 * Save row at its end that sticks to the bottom of the panel while the
 * section is on screen. Enter in one of its fields saves it too.
 */
function ServerSection({ server, section, children }: { server: ServerSettingsApi; section: SectionId; children: ReactNode }) {
  const { settings, sections, linking } = server.state
  const status = sections[section]
  const { title, saveName } = SECTION_COPY[section]
  const titleId = `${SERVER_ID_PREFIX}-${section}-title`
  const dirty = settings !== null && hasChanges(settings, section)
  const busy = status.busy || (section === 'access' && linking)

  return (
    <section aria-labelledby={titleId}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          if (dirty) void server.save(section)
        }}
        className="flex flex-col gap-4"
      >
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        {children}
        {status.formError && (
          <Callout tone="danger" role="alert">
            <p>{status.formError.message}</p>
          </Callout>
        )}
        <div className="sticky bottom-0 z-[5] flex items-center gap-3 border-t bg-background/85 py-3 backdrop-blur-md">
          <p className="mr-auto flex items-center gap-1.5 text-sm text-muted-foreground">
            {dirty && !busy && 'Unsaved changes'}
            {/* Always there, so saving and saved are read out */}
            <span role="status" className="flex items-center gap-1.5">
              {busy ? (
                'Saving…'
              ) : status.saved && !dirty ? (
                <>
                  <Check className="size-4 text-success" aria-hidden="true" />
                  Saved
                </>
              ) : null}
            </span>
          </p>
          {/* Focusable while there is nothing to save, so focus stays put after a save */}
          <Button type="submit" aria-disabled={!dirty || busy || undefined} className="h-11 px-5 aria-disabled:opacity-50">
            {busy && <LoaderCircle className="animate-spin" aria-hidden="true" />}
            Save{' '}<span className="sr-only">{saveName}</span>
          </Button>
        </div>
      </form>
    </section>
  )
}

/** While a Plex server is linked: which one, and Re-link Plex to sign in and link it (or another) again. */
function PlexRelink({ server }: { server: ServerSettingsApi }) {
  const { state } = server
  const errors = state.sections.access.errors
  const name = state.settings?.view.plexServerName ?? 'your Plex server'
  const picked = state.plex.servers.find((candidate) => candidate.machineId === state.plex.machineId)

  if (!state.relinking) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          Linked to <span className="font-semibold [overflow-wrap:anywhere]">{name}</span>
        </p>
        <Button id={RELINK_BUTTON_ID} type="button" variant="outline" className={SMALL_BUTTON} onClick={server.openRelink}>
          Re-link Plex
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border p-4">
      <p className={HELP}>
        Sign in with the Plex account that owns the server, then pick it: the club keeps that sign-in to check who can join. Admins stay as they are.
      </p>
      <PlexSignInPanel
        plex={state.plex}
        buttonId={errorTargetId(SERVER_ID_PREFIX, 'plexLink')}
        error={errors.plex}
        disabled={state.linking}
        onToken={server.plexSignIn}
        onSignOut={server.plexSignedOut}
        onPick={server.pickServer}
        onRefresh={server.refreshServers}
        returnPath="/"
        onBeforeRedirect={server.stashForRedirect}
      />
      {errors.plexLink && (
        <div role="alert">
          <FieldMessage id={`${SERVER_ID_PREFIX}-plexLink-err`} tone="error">
            {errors.plexLink}
          </FieldMessage>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {picked && (
          <Button type="button" className={SMALL_BUTTON} aria-disabled={state.linking || undefined} onClick={() => void server.relink()}>
            {state.linking ? 'Linking…' : `Link ${picked.name}`}
          </Button>
        )}
        <Button type="button" variant="ghost" className={SMALL_BUTTON} disabled={state.linking} onClick={server.closeRelink}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/**
 * The Admin panel's Server tab: where channels come from, who can join, the
 * extras and the advanced settings, as the setup wizard set them. Settings
 * the server's environment sets are locked; the house rules are on People.
 */
export function ServerTab() {
  const server = useServerSettings()
  const { state } = server
  const token = useAuthStore((s) => s.token)
  const plexId = token ? decodeTokenPayload(token)?.plex_id : undefined
  const selfPlexId = typeof plexId === 'string' ? plexId : null

  if (!state.settings) {
    return server.configError ? (
      <Callout tone="danger" role="alert">
        <p>{server.configError}</p>
        <div>
          <Button type="button" variant="outline" className={SMALL_BUTTON} onClick={server.retryConfig}>
            Try again
          </Button>
        </div>
      </Callout>
    ) : (
      <p role="status" className="text-sm text-muted-foreground">
        Loading the server's settings…
      </p>
    )
  }

  const settings = state.settings
  const { view } = settings
  const access = state.sections.access
  const accessBusy = access.busy || state.linking

  return (
    <CardHeadingLevel value={3}>
      <div className="@container/server flex max-w-3xl flex-col gap-10 pt-1">
        {view.storage.settingsFile === null ? (
          <FieldMessage tone="warning">
            This server has nowhere to keep settings, so nothing here can be saved. Give it a /data volume and restart it.
          </FieldMessage>
        ) : (
          <p className={HELP}>
            Changes apply as soon as each part is saved, and are kept in{' '}
            <code className="font-mono text-xs [overflow-wrap:anywhere]">{view.storage.settingsFile}</code>. What the
            server's environment sets is locked here.
          </p>
        )}

        <ServerSection server={server} section="sources">
          <SourcesSection
            state={settings}
            errors={state.sections.sources.errors}
            onField={server.setField}
            onSource={server.setSource}
            idPrefix={SERVER_ID_PREFIX}
            tests={state.tests}
            onTest={(kind) => void server.runTest(kind)}
          />
        </ServerSection>

        <ServerSection server={server} section="access">
          <AccessSection
            state={settings}
            errors={access.errors}
            onField={server.setField}
            idPrefix={SERVER_ID_PREFIX}
            adminSignIn={selfPlexId ? 'plex' : 'password'}
            selfPlexId={selfPlexId}
            // Loading from the moment a server is linked
            members={state.members ?? 'loading'}
            showHouseRules={false}
            plexConnect={
              <PlexSignInPanel
                plex={state.plex}
                buttonId={errorTargetId(SERVER_ID_PREFIX, 'plexLink')}
                error={access.errors.plex}
                disabled={accessBusy}
                onToken={server.plexSignIn}
                onSignOut={server.plexSignedOut}
                onPick={server.pickServer}
                onRefresh={server.refreshServers}
                returnPath="/"
                onBeforeRedirect={server.stashForRedirect}
              />
            }
            // Sign-in set in the environment can't be linked from here
            linkedServer={lockedBy(view, 'plexAuthEnabled') === null ? <PlexRelink server={server} /> : undefined}
          />
        </ServerSection>

        <ServerSection server={server} section="extras">
          <ExtrasSection
            state={settings}
            errors={state.sections.extras.errors}
            onField={server.setField}
            idPrefix={SERVER_ID_PREFIX}
            tests={state.tests}
            onTest={(kind) => void server.runTest(kind)}
          />
        </ServerSection>

        <ServerSection server={server} section="advanced">
          <AdvancedSection
            state={settings}
            errors={state.sections.advanced.errors}
            onField={server.setField}
            idPrefix={SERVER_ID_PREFIX}
            onReset={server.resetAdvanced}
          />
        </ServerSection>
      </div>
    </CardHeadingLevel>
  )
}
