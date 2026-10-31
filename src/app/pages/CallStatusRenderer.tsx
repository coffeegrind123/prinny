import { useCallEmbed } from '../hooks/useCallEmbed';
import { CallStatus, CallVoicePanel } from '../features/call-status';
import { useSelectedRoom } from '../hooks/router/useSelectedRoom';
import { ScreenSize, useScreenSizeContext } from '../hooks/useScreenSize';
import { useSetting } from '../state/hooks/settings';
import { settingsAtom } from '../state/settings';

export function CallStatusRenderer() {
  const callEmbed = useCallEmbed();
  const selectedRoom = useSelectedRoom();
  const [voicePanel] = useSetting(settingsAtom, 'callVoicePanel');

  const screenSize = useScreenSizeContext();

  if (!callEmbed || voicePanel) return null;

  if (screenSize === ScreenSize.Mobile && callEmbed.roomId === selectedRoom) return null;

  return <CallStatus callEmbed={callEmbed} />;
}

/** The call status as a panel at the bottom of the room list, when that setting is on. */
export function CallVoicePanelRenderer() {
  const callEmbed = useCallEmbed();
  const selectedRoom = useSelectedRoom();
  const [voicePanel] = useSetting(settingsAtom, 'callVoicePanel');

  const screenSize = useScreenSizeContext();

  if (!callEmbed || !voicePanel) return null;

  if (screenSize === ScreenSize.Mobile && callEmbed.roomId === selectedRoom) return null;

  return <CallVoicePanel callEmbed={callEmbed} />;
}
