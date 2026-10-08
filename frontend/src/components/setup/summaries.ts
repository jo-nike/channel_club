import type { SetupFacts } from '@/types/setup'
import { fieldValue, secretEntry, secretFilled, sourceOn, type SettingsState, type SourceKind } from '@/components/server-settings/model/configDraft'
import { testStatus } from '@/components/server-settings/model/testResults'
import type { StepId } from './steps'
import type { WizardState } from './wizardReducer'

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** The Plex server the claim form has picked, by name. */
export function pickedServerName(state: WizardState): string | null {
  return state.plex.servers.find((server) => server.machineId === state.plex.machineId)?.name ?? null
}

/** A done step's one line in the rail: what was chosen there. */
export function stepSummary(state: WizardState, step: StepId): string {
  const settings = state.settings
  switch (step) {
    case 'welcome':
      return ''
    case 'account': {
      if (state.admin) {
        return state.admin.signIn === 'plex'
          ? `Plex · ${settings?.view.plexServerName ?? pickedServerName(state) ?? 'your server'}`
          : `Password · ${state.admin.username}`
      }
      if (state.account.method === 'password') return `Password · ${state.account.username || 'admin'}`
      const server = state.plex.account ? pickedServerName(state) : null
      return server ? `Plex · ${server}` : 'Plex'
    }
    case 'sources': {
      if (!settings) return ''
      const on = [sourceOn(settings, 'dispatcharr') && 'Dispatcharr', sourceOn(settings, 'ersatztv') && 'ErsatzTV']
      return on.filter(Boolean).join(' + ') || 'No source yet'
    }
    case 'access': {
      if (!settings) return ''
      const parts: string[] = []
      if (fieldValue(settings, 'plexAuthEnabled') && settings.view.values.plexServerMachineId) {
        parts.push('Plex members')
      }
      if (fieldValue(settings, 'localAuthEnabled')) {
        parts.push(secretFilled(secretEntry(settings, 'viewerPassword')) ? 'passwords, guest' : 'passwords')
      }
      return capitalise(parts.join(', ') || 'admin only')
    }
    case 'extras': {
      if (!settings) return ''
      const on = [
        fieldValue(settings, 'chatEnabled') && 'chat',
        fieldValue(settings, 'highlightEnabled') && 'clips',
        fieldValue(settings, 'nhlEnabled') && 'NHL scores',
        fieldValue(settings, 'ntfyEnabled') && 'feedback',
      ]
      return capitalise(on.filter(Boolean).join(', ') || 'none')
    }
    case 'review':
      return 'Checked'
  }
}

/** A line of Review's summary; a warning when something there won't work as it stands. */
export interface ReviewLine {
  text: string
  warn?: boolean
}

export interface ReviewRow {
  step: 'account' | 'sources' | 'access' | 'extras'
  lines: ReviewLine[]
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

const SOURCE_NAME: Record<SourceKind, string> = { dispatcharr: 'Dispatcharr', ersatztv: 'ErsatzTV' }

/** A source as Review shows it: how its last test went, for the address shown now. */
function sourceLine(state: WizardState, settings: SettingsState, kind: SourceKind): ReviewLine {
  const name = SOURCE_NAME[kind]
  const record = state.tests[kind]
  switch (testStatus(record, settings, kind)) {
    case 'failed':
      return { text: `${name} · last test failed`, warn: true }
    case 'passed': {
      const channels = record?.result?.counts?.channels
      return { text: `${name} · ${typeof channels === 'number' ? plural(channels, 'channel', 'channels') : 'test passed'}` }
    }
    default:
      return { text: `${name} · not tested` }
  }
}

/** Review's summary of each step: what the club will be once it opens. */
export function reviewRows(state: WizardState, settings: SettingsState): ReviewRow[] {
  const { view } = settings
  const serverName = view.plexServerName ?? 'your Plex server'
  const admin = state.admin

  const account: ReviewLine[] = admin?.signIn === 'plex'
    ? [{ text: `Plex, signed in as ${admin.username}` }, { text: `Server: ${serverName}` }]
    : [{ text: `Username and password, as ${admin?.username ?? fieldValue(settings, 'adminUsername')}` }]

  const sources = (['dispatcharr', 'ersatztv'] as const)
    .filter((kind) => sourceOn(settings, kind))
    .map((kind) => sourceLine(state, settings, kind))

  const access: ReviewLine[] = []
  if (fieldValue(settings, 'plexAuthEnabled') && view.values.plexServerMachineId) {
    access.push({ text: `Plex members of ${serverName} join as viewers` })
    if (Array.isArray(state.members)) {
      const ids = fieldValue(settings, 'plexAdminIds')
      const names = state.members.filter((member) => member.owner || ids.includes(member.plexId)).map((member) => member.username)
      if (names.length > 0) access.push({ text: `Admins: ${names.join(', ')}` })
    }
  }
  if (fieldValue(settings, 'localAuthEnabled')) {
    const adminLogin = secretFilled(secretEntry(settings, 'adminPassword'))
    access.push({ text: adminLogin ? `Admin login: ${fieldValue(settings, 'adminUsername')}` : 'No password admin login' })
    const guestLogin = secretFilled(secretEntry(settings, 'viewerPassword'))
    access.push({ text: guestLogin ? `Guest login: ${fieldValue(settings, 'viewerUsername')}` : 'No guest login' })
  }
  access.push({ text: fieldValue(settings, 'userChannelSelection') ? 'Anyone can change the live channel' : 'Only admins change the live channel' })
  access.push({ text: fieldValue(settings, 'presenceVisible') ? 'Everyone sees what others watch' : 'Others see only who is online' })

  const extras: ReviewLine[] = []
  if (fieldValue(settings, 'chatEnabled')) {
    extras.push({ text: secretFilled(secretEntry(settings, 'giphyApiKey')) ? 'Chat, with GIFs' : 'Chat' })
  }
  if (fieldValue(settings, 'highlightEnabled')) {
    extras.push({ text: fieldValue(settings, 'ziplineEnabled') ? 'Clips, shared through Zipline' : 'Clips' })
  }
  if (fieldValue(settings, 'nhlEnabled')) extras.push({ text: 'NHL scores' })
  if (fieldValue(settings, 'ntfyEnabled')) extras.push({ text: `Feedback to the ntfy topic ${fieldValue(settings, 'ntfyTopic').trim()}` })

  return [
    { step: 'account', lines: account },
    { step: 'sources', lines: sources.length > 0 ? sources : [{ text: 'No source yet', warn: true }] },
    { step: 'access', lines: access },
    { step: 'extras', lines: extras.length > 0 ? extras : [{ text: 'None' }] },
  ]
}

/** What the On air screen says about the club, at most four things. */
export function onAirFacts(facts: SetupFacts): string[] {
  const list: string[] = []
  const counts = [facts.dispatcharrChannels, facts.ersatztvChannels].filter((n): n is number => n !== null)
  if (counts.length > 0) {
    const channels = counts.reduce((sum, n) => sum + n, 0)
    list.push(plural(channels, 'channel', 'channels'))
  }
  if (facts.plexServerName) list.push(`Members of ${facts.plexServerName} can join`)
  if (facts.features.chat) list.push('Chat on')
  if (facts.features.clips) list.push('Clips on')
  return list
}
