// Relative by default: Vite proxies /api in development and the backend serves
// it from the application origin in production (including LAN clients).
export const API_URL = import.meta.env.VITE_API_URL || '/api'
