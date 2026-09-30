import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/server-settings/fields/Callout'
import { SCROLL_MARGIN, SMALL_BUTTON } from '@/components/server-settings/fields/styles'
import type { FormError } from '@/components/server-settings/model/failures'
import { FORM_ERROR_ID } from './useSetupWizard'

/** What stops the step going on. When someone else has set up the club, it offers the sign-in page instead. */
export function FormErrorCallout({ error }: { error: FormError | null }) {
  const navigate = useNavigate()
  if (!error) return null

  return (
    <Callout tone="danger" role="alert" id={FORM_ERROR_ID} className={SCROLL_MARGIN}>
      <p>{error.message}</p>
      {error.signIn && (
        <div>
          <Button type="button" variant="outline" className={SMALL_BUTTON} onClick={() => void navigate('/', { replace: true })}>
            Go to sign in
          </Button>
        </div>
      )}
    </Callout>
  )
}
