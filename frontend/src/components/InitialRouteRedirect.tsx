import { Navigate } from 'react-router-dom'

/**
 * InitialRouteRedirect redirects to the unified TV view.
 * All viewing now happens in /tv which combines live and on-demand content.
 */
export function InitialRouteRedirect() {
  return <Navigate to="/tv" replace />
}
