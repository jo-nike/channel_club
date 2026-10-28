import { CalendarClock, SatelliteDish } from 'lucide-react'
import { fieldValue, lockedBy, secretEntry, sourceOn } from '../model/configDraft'
import { Callout } from '../fields/Callout'
import { SecretField } from '../fields/SecretField'
import { SettingCard } from '../fields/SettingCard'
import { TestConnection } from '../fields/TestConnection'
import { UrlField } from '../fields/UrlField'
import { testView } from './testChecks'
import type { SectionProps, SourceChange, TestProps } from './types'

interface SourcesSectionProps extends SectionProps, TestProps {
  onSource: SourceChange
}

/** Where channels come from: Dispatcharr, ErsatzTV or both, each with a connection test. */
export function SourcesSection({ state, errors, onField, onSource, idPrefix, tests, onTest }: SourcesSectionProps) {
  const { view } = state
  const urlLock = lockedBy(view, 'dispatcharrUrl')
  const ersatztvLock = lockedBy(view, 'ersatztvBaseUrl')
  const dispatcharrTest = testView(state, tests, 'dispatcharr')
  const ersatztvTest = testView(state, tests, 'ersatztv')

  return (
    <>
      {errors.sources && (
        <Callout tone="danger" role="alert" id={`${idPrefix}-sources-error`}>
          <p>{errors.sources}</p>
        </Callout>
      )}

      <SettingCard
        id={`${idPrefix}-card-dispatcharr`}
        icon={SatelliteDish}
        title="Dispatcharr"
        description="Live channels from your IPTV providers, with their guide."
        toggle={{
          id: `${idPrefix}-source-dispatcharr`,
          checked: sourceOn(state, 'dispatcharr'),
          onChange: (on) => onSource('dispatcharr', on),
          disabled: urlLock !== null,
        }}
      >
        <UrlField
          id={`${idPrefix}-dispatcharrUrl`}
          label="Address"
          value={fieldValue(state, 'dispatcharrUrl')}
          onChange={(value) => onField('dispatcharrUrl', value)}
          placeholder="https://dispatcharr.example.com"
          help="Phones and TVs play streams straight from this address, so it has to work from every device, not only from this server."
          warn="dispatcharr"
          error={errors.dispatcharrUrl}
          lockedBy={urlLock}
        />
        <SecretField
          id={`${idPrefix}-dispatcharrApiKey`}
          label="API key"
          noun="API key"
          kind="key"
          entry={secretEntry(state, 'dispatcharrApiKey')}
          onChange={(value) => onField('dispatcharrApiKey', value)}
          placeholder="Paste the key"
          help="In Dispatcharr, open your profile and create an API key. Needs Dispatcharr 0.20 or later."
          error={errors.dispatcharrApiKey}
          lockedBy={lockedBy(view, 'dispatcharrApiKey')}
        />
        <TestConnection
          id={`${idPrefix}-test-dispatcharr`}
          {...dispatcharrTest}
          onTest={() => onTest('dispatcharr')}
        />
      </SettingCard>

      <SettingCard
        id={`${idPrefix}-card-ersatztv`}
        icon={CalendarClock}
        title="ErsatzTV"
        description="Channels you schedule from your own media, with a programme guide."
        toggle={{
          id: `${idPrefix}-source-ersatztv`,
          checked: sourceOn(state, 'ersatztv'),
          onChange: (on) => onSource('ersatztv', on),
          disabled: ersatztvLock !== null,
        }}
      >
        <UrlField
          id={`${idPrefix}-ersatztvBaseUrl`}
          label="Address"
          value={fieldValue(state, 'ersatztvBaseUrl')}
          onChange={(value) => onField('ersatztvBaseUrl', value)}
          placeholder="http://ersatztv.example.com:8409"
          help={
            <>
              Only this server needs to reach it. Channel Club reads <code className="font-mono text-xs">/iptv/channels.m3u</code> and{' '}
              <code className="font-mono text-xs">/iptv/xmltv.xml</code> here and relays the streams to everyone.
            </>
          }
          warn="ersatztv"
          error={errors.ersatztvBaseUrl}
          lockedBy={ersatztvLock}
        />
        <SecretField
          id={`${idPrefix}-ersatztvApiKey`}
          label="API key (optional)"
          noun="API key"
          kind="key"
          entry={secretEntry(state, 'ersatztvApiKey')}
          onChange={(value) => onField('ersatztvApiKey', value)}
          placeholder="Paste the key"
          help={
            <>
              Only needed for the session stats in Admin › Status (ErsatzTV 26.8.1 or later). It's in{' '}
              <code className="font-mono text-xs">api-secrets.json</code> in ErsatzTV's config folder.
            </>
          }
          error={errors.ersatztvApiKey}
          lockedBy={lockedBy(view, 'ersatztvApiKey')}
        />
        <TestConnection id={`${idPrefix}-test-ersatztv`} {...ersatztvTest} onTest={() => onTest('ersatztv')} />
      </SettingCard>
    </>
  )
}
