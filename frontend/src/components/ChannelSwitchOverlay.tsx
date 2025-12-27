interface ChannelSwitchOverlayProps {
  channelName: string
  isVisible: boolean
}

export function ChannelSwitchOverlay({
  channelName,
  isVisible,
}: ChannelSwitchOverlayProps) {
  if (!isVisible) return null

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm transition-opacity duration-300">
      <div className="h-12 w-12 animate-spin rounded-full border-4 border-white border-t-transparent" />
      <p className="mt-4 text-xl text-white">Loading {channelName}...</p>
    </div>
  )
}
