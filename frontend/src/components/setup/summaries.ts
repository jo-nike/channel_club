import { fieldValue, secretEntry, secretFilled, sourceOn } from '@/components/server-settings/model/configDraft'
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
        parts.push(fieldValue(settings, 'plexDefaultRole') === 'admin' ? 'Plex, as admins' : 'Plex members')
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
        fieldValue(settings, 'castEnabled') && 'Chromecast',
        fieldValue(settings, 'ntfyEnabled') && 'feedback',
      ]
      return capitalise(on.filter(Boolean).join(', ') || 'none')
    }
    case 'review':
      return 'Checked'
  }
}
