import { Check, Clapperboard, CloudUpload, Dices, Image, Lightbulb, MessageCircle, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { fieldValue, lockedBy, newNtfyTopic, secretEntry } from '../model/configDraft'
import { Chip } from '../fields/Chip'
import { Field } from '../fields/Field'
import { SecretField } from '../fields/SecretField'
import { SettingCard } from '../fields/SettingCard'
import { Subsection } from '../fields/Subsection'
import { TestConnection } from '../fields/TestConnection'
import { ToggleRow } from '../fields/ToggleRow'
import { UrlField } from '../fields/UrlField'
import { INPUT, LOCKED_INPUT, SCROLL_MARGIN, SMALL_BUTTON, TWO_COLUMNS } from '../fields/styles'
import { testView } from './testChecks'
import type { SectionProps, TestProps } from './types'

/** The public ntfy server, filled in when feedback is first switched on. */
const NTFY_SH = 'https://ntfy.sh'

/** The extras: chat and GIFs, clips and Zipline, and feedback through ntfy. */
export function ExtrasSection({ state, errors, onField, idPrefix, tests, onTest }: SectionProps & TestProps) {
  const { view } = state
  const ffmpegReady = view.ffmpeg.ffmpeg && view.ffmpeg.ffprobe
  const ffmpegChip = ffmpegReady ? (
    <Chip tone="ok">
      <Check aria-hidden="true" />
      FFmpeg ready
    </Chip>
  ) : (
    <Chip>FFmpeg missing</Chip>
  )
  const clipsOn = fieldValue(state, 'highlightEnabled')
  const topicLock = lockedBy(view, 'ntfyTopic')

  // Switching feedback on starts from the public server and a topic nobody could guess
  const switchFeedback = (on: boolean) => {
    onField('ntfyEnabled', on)
    if (!on) return
    if (fieldValue(state, 'ntfyUrl').trim() === '' && lockedBy(view, 'ntfyUrl') === null) onField('ntfyUrl', NTFY_SH)
    if (fieldValue(state, 'ntfyTopic').trim() === '' && topicLock === null) onField('ntfyTopic', newNtfyTopic())
  }

  return (
    <>
      <SettingCard
        id={`${idPrefix}-card-chat`}
        icon={MessageCircle}
        title="Chat"
        description="A chat beside the player for everyone signed in. Recent messages stay for a day and clear when the server restarts."
        toggle={{
          id: `${idPrefix}-chatEnabled`,
          checked: fieldValue(state, 'chatEnabled'),
          onChange: (on) => onField('chatEnabled', on),
          disabled: lockedBy(view, 'chatEnabled') !== null,
        }}
      >
        <Subsection title="GIFs in chat" icon={Image} optional>
          <SecretField
            id={`${idPrefix}-giphyApiKey`}
            label="GIPHY API key"
            noun="GIPHY key"
            kind="key"
            entry={secretEntry(state, 'giphyApiKey')}
            onChange={(value) => onField('giphyApiKey', value)}
            placeholder="Paste the key"
            help="Free from developers.giphy.com. Without a key there is no GIF button."
            error={errors.giphyApiKey}
            lockedBy={lockedBy(view, 'giphyApiKey')}
          />
          <TestConnection
            id={`${idPrefix}-test-giphy`}
            label="Check key"
            busyLabel="Checking…"
            againLabel="Check again"
            small
            {...testView(state, tests, 'giphy')}
            onTest={() => onTest('giphy')}
          />
        </Subsection>
      </SettingCard>

      <SettingCard
        id={`${idPrefix}-card-clips`}
        icon={Clapperboard}
        title="Clips"
        badge={ffmpegChip}
        description="Anyone can grab the last minute of a channel, trim it and download it."
        toggle={{
          id: `${idPrefix}-highlightEnabled`,
          checked: clipsOn,
          onChange: (on) => onField('highlightEnabled', on),
          // Without FFmpeg clips can't record; one already on can still be switched off
          disabled: lockedBy(view, 'highlightEnabled') !== null || (!ffmpegReady && !clipsOn),
        }}
      >
        <ToggleRow
          id={`${idPrefix}-ziplineEnabled`}
          icon={CloudUpload}
          title="Share clips through Zipline"
          description="Upload a clip to your Zipline server and get a link to share. Uploads go through this server, so the token never reaches browsers."
          checked={fieldValue(state, 'ziplineEnabled')}
          onChange={(on) => onField('ziplineEnabled', on)}
          disabled={lockedBy(view, 'ziplineEnabled') !== null}
        />
        {fieldValue(state, 'ziplineEnabled') && (
          <div className="flex flex-col gap-[18px]">
            <UrlField
              id={`${idPrefix}-ziplineUrl`}
              label="Zipline address"
              value={fieldValue(state, 'ziplineUrl')}
              onChange={(value) => onField('ziplineUrl', value)}
              placeholder="https://clips.example.com"
              help={
                <>
                  The base address, without <code className="font-mono text-xs">/api/upload</code>.
                </>
              }
              warn="zipline"
              error={errors.ziplineUrl}
              lockedBy={lockedBy(view, 'ziplineUrl')}
            />
            <SecretField
              id={`${idPrefix}-ziplineToken`}
              label="Token"
              noun="Zipline token"
              kind="key"
              entry={secretEntry(state, 'ziplineToken')}
              onChange={(value) => onField('ziplineToken', value)}
              placeholder="Paste the token"
              error={errors.ziplineToken}
              lockedBy={lockedBy(view, 'ziplineToken')}
            />
            <TestConnection id={`${idPrefix}-test-zipline`} small {...testView(state, tests, 'zipline')} onTest={() => onTest('zipline')} />
          </div>
        )}
      </SettingCard>

      <SettingCard
        id={`${idPrefix}-card-feedback`}
        icon={Lightbulb}
        title="Feedback"
        description="A Send feedback button in the header. Reports reach your phone as ntfy notifications, with the app version and device attached."
        toggle={{
          id: `${idPrefix}-ntfyEnabled`,
          checked: fieldValue(state, 'ntfyEnabled'),
          onChange: switchFeedback,
          disabled: lockedBy(view, 'ntfyEnabled') !== null,
        }}
      >
        <div className={cn('grid gap-4', TWO_COLUMNS)}>
          <UrlField
            id={`${idPrefix}-ntfyUrl`}
            label="ntfy server"
            value={fieldValue(state, 'ntfyUrl')}
            onChange={(value) => onField('ntfyUrl', value)}
            error={errors.ntfyUrl}
            lockedBy={lockedBy(view, 'ntfyUrl')}
          />
          <Field
            id={`${idPrefix}-ntfyTopic`}
            label="Topic"
            error={errors.ntfyTopic}
            lockedBy={topicLock}
            labelAside={
              topicLock === null && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={SMALL_BUTTON}
                  onClick={() => onField('ntfyTopic', newNtfyTopic())}
                >
                  <Dices aria-hidden="true" />
                  New name
                </Button>
              )
            }
          >
            {(control) => (
              <Input
                {...control}
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={fieldValue(state, 'ntfyTopic')}
                readOnly={topicLock !== null}
                onChange={(event) => onField('ntfyTopic', event.target.value)}
                className={cn(INPUT, SCROLL_MARGIN, 'font-mono', topicLock && LOCKED_INPUT)}
              />
            )}
          </Field>
        </div>
        <p className="text-[13px] leading-[1.45] text-pretty text-muted-foreground">
          Anyone who knows a topic on a public server can read it, so keep a name nobody could guess.
        </p>
        <SecretField
          id={`${idPrefix}-ntfyToken`}
          label="Access token"
          optional
          noun="access token"
          kind="key"
          entry={secretEntry(state, 'ntfyToken')}
          onChange={(value) => onField('ntfyToken', value)}
          placeholder="Only for protected topics"
          error={errors.ntfyToken}
          lockedBy={lockedBy(view, 'ntfyToken')}
        />
        <TestConnection
          id={`${idPrefix}-test-ntfy`}
          label="Send a test notification"
          busyLabel="Sending…"
          againLabel="Send another"
          icon={Send}
          small
          {...testView(state, tests, 'ntfy')}
          onTest={() => onTest('ntfy')}
        />
      </SettingCard>
    </>
  )
}
