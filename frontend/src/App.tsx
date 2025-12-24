import { useAuth } from '@/hooks/useAuth'
import { LoginForm } from '@/components/LoginForm'
import { MainView } from '@/components/MainView'

export function App() {
  const { isAuthenticated } = useAuth()

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <LoginForm />
      </div>
    )
  }

  return <MainView />
}
