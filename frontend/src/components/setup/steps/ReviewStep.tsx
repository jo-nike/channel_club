import { useState, type Ref } from 'react'
import { ChevronDown, HardDrive, KeyRound, ListChecks, Lock, Pencil, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { FieldMessage } from '@/components/server-settings/fields/Field'
import { SMALL_BUTTON } from '@/components/server-settings/fields/styles'
import type { SettingsState } from '@/components/server-settings/model/configDraft'
import { SECTION_FIELDS } from '@/components/server-settings/model/fields'
import { AdvancedSection } from '@/components/server-settings/sections/AdvancedSection'
import { EnvironmentList } from '@/components/server-settings/sections/EnvironmentList'
import { cn } from '@/lib/utils'
import { STEP_NAMES } from '../steps'
import { reviewRows } from '../summaries'
import { ID_PREFIX, type SetupWizardApi } from '../useSetupWizard'
import { SettingsStep } from './SettingsStep'

const CARD_HEAD = 'flex items-start gap-3.5 px-5 py-[18px] max-[760px]:px-4'
const CARD_TITLE = 'font-sans text-base leading-[1.35] font-semibold'
const DESCRIPTION = 'text-sm text-pretty text-muted-foreground'

/** What was chosen in each step, with a way back to change it. */
function Summary({ wizard, settings }: { wizard: SetupWizardApi; settings: SettingsState }) {
  return (
    <Card className="gap-0 py-0">
      <dl className="m-0">
        {reviewRows(wizard.state, settings).map((row) => (
          <div
            key={row.step}
            className="grid grid-cols-[140px_minmax(0,1fr)_auto] items-start gap-x-4 gap-y-2 border-t py-[15px] pr-4 pl-5 first:border-t-0 max-[760px]:grid-cols-[minmax(0,1fr)_auto] max-[760px]:pl-4"
          >
            <dt className="pt-px text-sm font-semibold">{STEP_NAMES[row.step]}</dt>
            <dd className="m-0 flex min-w-0 flex-col gap-[3px] text-sm max-[760px]:col-span-full max-[760px]:row-start-2">
              {row.lines.map((line) => (
                <span key={line.text} className={cn('[overflow-wrap:anywhere]', line.warn && 'text-warning')}>
                  {line.text}
                </span>
              ))}
            </dd>
            {/* The account was made at the claim; the Admin panel changes it later */}
            {row.step !== 'account' && (
              <dd className="m-0 -mt-1.5 max-[760px]:col-start-2 max-[760px]:row-start-1">
                <Button type="button" variant="ghost" className={SMALL_BUTTON} onClick={() => wizard.goTo(row.step)}>
                  <Pencil aria-hidden="true" />
                  Edit{' '}<span className="sr-only">{STEP_NAMES[row.step]}</span>
                </Button>
              </dd>
            )}
          </div>
        ))}
      </dl>
    </Card>
  )
}

/** What setup took care of without asking: the signing key and where the settings live. */
function HandledForYou({ settings }: { settings: SettingsState }) {
  const { storage } = settings.view
  return (
    <Card className="gap-0 py-0">
      <div className={CARD_HEAD}>
        <ListChecks className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
        {/* A card title, not a display heading: the base rule would set it in the display face */}
        <h2 className={CARD_TITLE}>Handled for you</h2>
      </div>
      <ul className="m-0 list-none border-t p-0">
        <li className="flex gap-3.5 px-5 py-3.5 max-[760px]:px-4">
          <KeyRound className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div>
            <p className="font-semibold">Signing key</p>
            <p className={DESCRIPTION}>
              {storage.signingKey === 'settings' ? (
                <>
                  Created on this server and saved with your settings, so sign-ins survive restarts. A{' '}
                  <code className="font-mono text-xs">JWT_SECRET</code> in the environment still takes priority.
                </>
              ) : (
                <>
                  Set by <code className="font-mono text-xs">JWT_SECRET</code> in the server's environment.
                </>
              )}
            </p>
          </div>
        </li>
        <li className="flex gap-3.5 border-t px-5 py-3.5 max-[760px]:px-4">
          <HardDrive className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="flex min-w-0 flex-col gap-1">
            <p className="font-semibold">Settings file</p>
            {storage.settingsFile ? (
              <p className={DESCRIPTION}>
                Saved to <code className="font-mono text-xs [overflow-wrap:anywhere]">{storage.settingsFile}</code>. Keep that volume when you
                update the container.
              </p>
            ) : (
              <FieldMessage tone="warning">
                This server has nowhere to keep settings, so they last only until it restarts. Give the container a /data volume.
              </FieldMessage>
            )}
          </div>
        </li>
      </ul>
    </Card>
  )
}

/** The variables the server's environment sets, which setup leaves alone. */
function FromTheEnvironment({ settings }: { settings: SettingsState }) {
  return (
    <Card className="gap-0 py-0">
      <div className={CARD_HEAD}>
        <Lock className="mt-0.5 size-5 shrink-0 text-info" aria-hidden="true" />
        <div className="flex min-w-0 flex-col gap-[3px]">
          <h2 className={CARD_TITLE}>From the environment</h2>
          <p className={DESCRIPTION}>
            These stay as the server's environment sets them. To manage one here, remove it from the environment and restart.
          </p>
        </div>
      </div>
      <div className="border-t px-5 pt-[18px] pb-5 max-[760px]:px-4">
        <EnvironmentList environment={settings.view.environment} />
      </div>
    </Card>
  )
}

interface ReviewStepProps {
  wizard: SetupWizardApi
  headingRef: Ref<HTMLHeadingElement>
}

/** Step 6: the choices at a glance, what setup handled, and Advanced. Open Channel Club saves and finishes. */
export function ReviewStep({ wizard, headingRef }: ReviewStepProps) {
  const { state } = wizard
  const [advancedOpen, setAdvancedOpen] = useState(false)
  // A problem in Advanced keeps it open until fixed
  const advancedError = SECTION_FIELDS.advanced.some((field) => state.errors[field] !== undefined)
  const open = advancedOpen || advancedError

  return (
    <SettingsStep step="review" wizard={wizard} headingRef={headingRef}>
      {(settings) => (
        <>
          <Summary wizard={wizard} settings={settings} />
          <HandledForYou settings={settings} />
          {settings.view.environment.length > 0 && <FromTheEnvironment settings={settings} />}
          <Collapsible open={open} onOpenChange={setAdvancedOpen}>
            <Card className="gap-0 py-0">
              <CollapsibleTrigger
                aria-labelledby={`${ID_PREFIX}-advanced-title`}
                aria-describedby={`${ID_PREFIX}-advanced-help`}
                className="flex min-h-14 w-full items-start gap-3.5 rounded-xl px-5 py-[18px] text-left max-[760px]:px-4"
              >
                <SlidersHorizontal className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                  <span id={`${ID_PREFIX}-advanced-title`} className="text-base font-semibold">
                    Advanced settings
                  </span>
                  <span id={`${ID_PREFIX}-advanced-help`} className={DESCRIPTION}>
                    Tuned defaults for casting, clips, feedback and the server. Leave them unless you know why.
                  </span>
                </span>
                <ChevronDown
                  className={cn('mt-0.5 size-5 shrink-0 text-muted-foreground transition-transform duration-200', open && 'rotate-180')}
                  aria-hidden="true"
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="border-t px-5 pt-[18px] pb-5 max-[760px]:px-4">
                <AdvancedSection
                  state={settings}
                  errors={state.errors}
                  onField={wizard.setField}
                  idPrefix={ID_PREFIX}
                  onReset={wizard.resetAdvanced}
                />
              </CollapsibleContent>
            </Card>
          </Collapsible>
        </>
      )}
    </SettingsStep>
  )
}
