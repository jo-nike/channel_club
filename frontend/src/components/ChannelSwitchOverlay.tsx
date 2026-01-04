import { ProjectorBeamLoader } from '@/components/ProjectorBeamLoader'

interface ChannelSwitchOverlayProps {
  channelName: string
  isVisible: boolean
}

export function ChannelSwitchOverlay({
  channelName,
  isVisible,
}: ChannelSwitchOverlayProps) {
  if (!isVisible) return null

  return <ProjectorBeamLoader text={`Loading ${channelName}...`} />
}
