import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuthStore } from '@/stores/authStore'
import { login } from '@/services/api'

export function LoginForm() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const setAuth = useAuthStore((state) => state.setAuth)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      const response = await login({ username, password })
      setAuth(response.accessToken, response.role)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid credentials')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md space-y-6 p-8 border rounded-lg shadow-lg bg-card"
      >
        <h1 className="text-3xl font-bold text-center text-foreground">
          IPTV Viewer
        </h1>

        {error && (
          <div
            role="alert"
            className="p-4 text-xl text-destructive-foreground bg-destructive/10 border border-destructive rounded-md"
          >
            {error}
          </div>
        )}

        <div className="space-y-2">
          <label htmlFor="username" className="block text-xl text-foreground">
            Username
          </label>
          <Input
            id="username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Enter username"
            required
            disabled={isLoading}
            autoComplete="username"
            className="h-14 text-2xl px-4 focus:ring-2 focus:ring-offset-2"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="password" className="block text-xl text-foreground">
            Password
          </label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password"
            required
            disabled={isLoading}
            autoComplete="current-password"
            className="h-14 text-2xl px-4 focus:ring-2 focus:ring-offset-2"
          />
        </div>

        <Button
          type="submit"
          disabled={isLoading}
          className="h-14 text-2xl px-8 w-full focus:ring-2 focus:ring-offset-2"
        >
          {isLoading ? 'Signing in...' : 'Sign In'}
        </Button>
      </form>
    </div>
  )
}
