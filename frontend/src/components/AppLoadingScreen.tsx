export function AppLoadingScreen() {
  return (
    <div className="flex h-screen flex-col items-center justify-center bg-background">
      <div className="mb-4 text-4xl">📺</div>
      <h1 className="mb-4 text-2xl font-bold">IPTV Viewer</h1>
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  )
}
