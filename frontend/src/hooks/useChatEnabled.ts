/**
 * Hook to check if chat feature is enabled via VITE_CHAT_ENABLED env var.
 */
export function useChatEnabled(): boolean {
  return import.meta.env.VITE_CHAT_ENABLED === 'true'
}
