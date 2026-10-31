import { MouseEventHandler, useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  config,
  Icon,
  IconButton,
  Icons,
  Menu,
  MenuItem,
  PopOut,
  RectCords,
  Spinner,
  Text,
  toRem,
  Tooltip,
  TooltipProvider,
} from 'folds';
import { FocusTrap } from 'focus-trap-react';
import { useAtom, useAtomValue } from 'jotai';
import { SequenceCard } from '../../components/sequence-card';
import * as css from './styles.css';
import {
  ChatButton,
  ControlDivider,
  MicrophoneButton,
  ScreenShareButton,
  SoundButton,
  VideoButton,
} from './Controls';
import { CallEmbed, useCallControlState } from '../../plugins/call';
import { useResizeObserver } from '../../hooks/useResizeObserver';
import { stopPropagation } from '../../utils/keyboard';
import { AsyncStatus, useAsyncCallback } from '../../hooks/useAsyncCallback';
import { useKeybind } from '../../hooks/useKeybind';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { callFullscreenAtom, callIdleAtom } from '../../state/callEmbed';
import { InviteUserPrompt } from '../../components/invite-user-prompt';

type CallControlsProps = {
  callEmbed: CallEmbed;
};

/**
 * Call keybinds — only active while the controls are mounted, which is the
 * same lifetime as the active CallEmbed. So these never fire when there's no
 * call.
 */
function useCallKeybinds(callEmbed: CallEmbed, exiting: boolean, hangup: () => void) {
  useKeybind('call-toggle-microphone', () => {
    callEmbed.control.toggleMicrophone();
  });
  useKeybind('call-toggle-video', () => {
    callEmbed.control.toggleVideo();
  });
  useKeybind('call-toggle-screenshare', () => {
    callEmbed.control.toggleScreenshare();
  });
  useKeybind('call-toggle-sound', () => {
    callEmbed.control.toggleSound();
  });
  useKeybind('call-hangup', () => {
    if (!exiting) hangup();
  });
}

function ClassicCallControls({ callEmbed }: CallControlsProps) {
  const controlRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(document.body.clientWidth < 500);

  useResizeObserver(
    useCallback(() => {
      const element = controlRef.current;
      if (!element) return;
      setCompact(element.clientWidth < 500);
    }, []),
    useCallback(() => controlRef.current, []),
  );

  const { microphone, video, sound, screenshare, spotlight } = useCallControlState(
    callEmbed.control,
  );

  const [cords, setCords] = useState<RectCords>();

  const handleOpenMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
    setCords(evt.currentTarget.getBoundingClientRect());
  };

  const handleSpotlightClick = () => {
    callEmbed.control.toggleSpotlight();
    setCords(undefined);
  };

  const handleReactionsClick = () => {
    callEmbed.control.toggleReactions();
    setCords(undefined);
  };

  const handleSettingsClick = () => {
    callEmbed.control.toggleSettings();
    setCords(undefined);
  };

  const handleMicrophoneToggle = useCallback(
    () => callEmbed.control.toggleMicrophone(),
    [callEmbed],
  );
  const handleVideoToggle = useCallback(() => callEmbed.control.toggleVideo(), [callEmbed]);

  const [hangupState, hangup] = useAsyncCallback(
    useCallback(() => callEmbed.hangup(), [callEmbed]),
  );
  const exiting =
    hangupState.status === AsyncStatus.Loading || hangupState.status === AsyncStatus.Success;

  useCallKeybinds(callEmbed, exiting, hangup);

  return (
    <Box
      ref={controlRef}
      className={css.CallControlContainer}
      justifyContent="Center"
      alignItems="Center"
    >
      <SequenceCard
        className={css.ControlCard}
        variant="SurfaceVariant"
        gap="400"
        radii="500"
        alignItems="Center"
        justifyContent="SpaceBetween"
      >
        <Box alignItems="Center" gap="Inherit" grow="Yes" direction={compact ? 'Column' : 'Row'}>
          <Box shrink="No" alignItems="Inherit" justifyContent="Inherit" gap="200">
            <MicrophoneButton enabled={microphone} onToggle={handleMicrophoneToggle} />
            <SoundButton enabled={sound} onToggle={() => callEmbed.control.toggleSound()} />
          </Box>
          {!compact && <ControlDivider />}
          <Box shrink="No" alignItems="Inherit" justifyContent="Inherit" gap="200">
            <VideoButton enabled={video} onToggle={handleVideoToggle} />
            <ScreenShareButton
              enabled={screenshare}
              onToggle={() => callEmbed.control.toggleScreenshare()}
            />
          </Box>
        </Box>
        {!compact && <ControlDivider />}
        <Box alignItems="Center" gap="Inherit" grow="Yes" direction={compact ? 'Column' : 'Row'}>
          <Box shrink="No" alignItems="Inherit" justifyContent="Inherit" gap="200">
            <ChatButton />
            <PopOut
              anchor={cords}
              position="Top"
              align="Center"
              content={
                <FocusTrap
                  focusTrapOptions={{
                    initialFocus: false,
                    onDeactivate: () => setCords(undefined),
                    clickOutsideDeactivates: true,
                    isKeyForward: (evt: KeyboardEvent) => evt.key === 'ArrowDown',
                    isKeyBackward: (evt: KeyboardEvent) => evt.key === 'ArrowUp',
                    escapeDeactivates: stopPropagation,
                  }}
                >
                  <Menu>
                    <Box direction="Column" style={{ padding: config.space.S100 }}>
                      <MenuItem
                        size="300"
                        variant="Surface"
                        radii="300"
                        onClick={handleSpotlightClick}
                      >
                        <Text size="B300" truncate>
                          {spotlight ? 'Grid View' : 'Spotlight View'}
                        </Text>
                      </MenuItem>
                      <MenuItem
                        size="300"
                        variant="Surface"
                        radii="300"
                        onClick={handleReactionsClick}
                      >
                        <Text size="B300" truncate>
                          Reactions
                        </Text>
                      </MenuItem>
                      <MenuItem
                        size="300"
                        variant="Surface"
                        radii="300"
                        onClick={handleSettingsClick}
                      >
                        <Text size="B300" truncate>
                          Settings
                        </Text>
                      </MenuItem>
                    </Box>
                  </Menu>
                </FocusTrap>
              }
            >
              <IconButton
                variant="Surface"
                fill="Soft"
                radii="400"
                size="400"
                onClick={handleOpenMenu}
                outlined
                aria-pressed={!!cords}
              >
                <Icon size="400" src={Icons.VerticalDots} />
              </IconButton>
            </PopOut>
          </Box>
          <Box shrink="No" direction="Column">
            <Button
              style={{ minWidth: toRem(88) }}
              variant="Critical"
              fill="Solid"
              onClick={hangup}
              before={
                exiting ? (
                  <Spinner variant="Critical" fill="Solid" size="200" />
                ) : (
                  <Icon src={Icons.PhoneDown} size="200" filled />
                )
              }
              disabled={exiting}
            >
              <Text size="B400">End</Text>
            </Button>
          </Box>
        </Box>
      </SequenceCard>
    </Box>
  );
}

/**
 * Grouped mic/deafen/camera and screen share/more buttons, a wide end-call
 * button, invite and fullscreen on the edges. Fades with the header while the
 * call is idle; chat moves to the header's toggle.
 */
function RedesignedCallControls({ callEmbed }: CallControlsProps) {
  const idle = useAtomValue(callIdleAtom);
  const [invitePrompt, setInvitePrompt] = useState(false);
  const [fullscreen, setFullscreen] = useAtom(callFullscreenAtom);

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      setFullscreen(false);
    };
  }, [setFullscreen]);

  // Fullscreens the app window and hides the app chrome (see ClientLayout /
  // PageRoot), so only the call view is left.
  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
      return;
    }
    document.documentElement.requestFullscreen();
  };

  const { microphone, video, sound, screenshare, spotlight } = useCallControlState(
    callEmbed.control,
  );

  const [cords, setCords] = useState<RectCords>();

  const handleOpenMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
    setCords(evt.currentTarget.getBoundingClientRect());
  };

  const handleSpotlightClick = () => {
    callEmbed.control.toggleSpotlight();
    setCords(undefined);
  };

  const handleReactionsClick = () => {
    callEmbed.control.toggleReactions();
    setCords(undefined);
  };

  const handleSettingsClick = () => {
    callEmbed.control.toggleSettings();
    setCords(undefined);
  };

  const handleMicrophoneToggle = useCallback(
    () => callEmbed.control.toggleMicrophone(),
    [callEmbed],
  );
  const handleVideoToggle = useCallback(() => callEmbed.control.toggleVideo(), [callEmbed]);

  const [hangupState, hangup] = useAsyncCallback(
    useCallback(() => callEmbed.hangup(), [callEmbed]),
  );
  const exiting =
    hangupState.status === AsyncStatus.Loading || hangupState.status === AsyncStatus.Success;

  useCallKeybinds(callEmbed, exiting, hangup);

  return (
    <Box
      className={css.RedesignControlContainer}
      style={{
        opacity: idle ? 0 : 1,
        pointerEvents: idle ? 'none' : undefined,
        transition: 'opacity 0.3s ease',
      }}
      justifyContent="Center"
      alignItems="Center"
      gap="300"
      wrap="Wrap"
    >
      <Box className={css.EdgeControlLeft} alignItems="Center">
        <TooltipProvider
          position="Top"
          delay={500}
          tooltip={
            <Tooltip>
              <Text size="T200">Invite to Call</Text>
            </Tooltip>
          }
        >
          {(anchorRef) => (
            <IconButton
              ref={anchorRef}
              variant="Surface"
              fill="None"
              radii="400"
              size="400"
              onClick={() => setInvitePrompt(true)}
              aria-label="Invite to call"
            >
              <Icon size="400" src={Icons.UserPlus} />
            </IconButton>
          )}
        </TooltipProvider>
        {invitePrompt && (
          <InviteUserPrompt room={callEmbed.room} requestClose={() => setInvitePrompt(false)} />
        )}
      </Box>
      <Box className={css.EdgeControlRight} alignItems="Center">
        <TooltipProvider
          position="Top"
          align="End"
          delay={500}
          tooltip={
            <Tooltip>
              <Text size="T200">{fullscreen ? 'Exit Full Screen' : 'Full Screen'}</Text>
            </Tooltip>
          }
        >
          {(anchorRef) => (
            <IconButton
              ref={anchorRef}
              variant="Surface"
              fill="None"
              radii="400"
              size="400"
              onClick={toggleFullscreen}
              aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
              aria-pressed={fullscreen}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
                <path
                  fill="currentColor"
                  d="M4 6c0-1.1.9-2 2-2h3a1 1 0 0 0 0-2H6a4 4 0 0 0-4 4v3a1 1 0 0 0 2 0V6ZM4 18c0 1.1.9 2 2 2h3a1 1 0 1 1 0 2H6a4 4 0 0 1-4-4v-3a1 1 0 1 1 2 0v3ZM18 4a2 2 0 0 1 2 2v3a1 1 0 1 0 2 0V6a4 4 0 0 0-4-4h-3a1 1 0 1 0 0 2h3ZM20 18a2 2 0 0 1-2 2h-3a1 1 0 1 0 0 2h3a4 4 0 0 0 4-4v-3a1 1 0 1 0-2 0v3Z"
                />
              </svg>
            </IconButton>
          )}
        </TooltipProvider>
      </Box>
      <Box className={css.ControlGroup} alignItems="Center" gap="100">
        <MicrophoneButton enabled={microphone} onToggle={handleMicrophoneToggle} critical />
        <SoundButton enabled={sound} onToggle={() => callEmbed.control.toggleSound()} critical />
        <VideoButton enabled={video} onToggle={handleVideoToggle} />
      </Box>
      <Box className={css.ControlGroup} alignItems="Center" gap="100">
        <ScreenShareButton
          enabled={screenshare}
          onToggle={() => callEmbed.control.toggleScreenshare()}
        />
        <PopOut
          anchor={cords}
          position="Top"
          align="Center"
          content={
            <FocusTrap
              focusTrapOptions={{
                initialFocus: false,
                onDeactivate: () => setCords(undefined),
                clickOutsideDeactivates: true,
                isKeyForward: (evt: KeyboardEvent) => evt.key === 'ArrowDown',
                isKeyBackward: (evt: KeyboardEvent) => evt.key === 'ArrowUp',
                escapeDeactivates: stopPropagation,
              }}
            >
              <Menu>
                <Box direction="Column" style={{ padding: config.space.S100 }}>
                  <MenuItem size="300" variant="Surface" radii="300" onClick={handleSpotlightClick}>
                    <Text size="B300" truncate>
                      {spotlight ? 'Grid View' : 'Spotlight View'}
                    </Text>
                  </MenuItem>
                  <MenuItem size="300" variant="Surface" radii="300" onClick={handleReactionsClick}>
                    <Text size="B300" truncate>
                      Reactions
                    </Text>
                  </MenuItem>
                  <MenuItem size="300" variant="Surface" radii="300" onClick={handleSettingsClick}>
                    <Text size="B300" truncate>
                      Settings
                    </Text>
                  </MenuItem>
                </Box>
              </Menu>
            </FocusTrap>
          }
        >
          <IconButton
            variant="Surface"
            fill="Soft"
            radii="400"
            size="400"
            onClick={handleOpenMenu}
            outlined
            aria-pressed={!!cords}
          >
            <Icon size="400" src={Icons.VerticalDots} />
          </IconButton>
        </PopOut>
      </Box>
      <Button
        className={css.EndButton}
        variant="Critical"
        fill="Solid"
        size="500"
        onClick={hangup}
        aria-label="End call"
        disabled={exiting}
      >
        {exiting ? (
          <Spinner variant="Critical" fill="Solid" size="200" />
        ) : (
          <Icon src={Icons.PhoneDown} size="300" filled />
        )}
      </Button>
    </Box>
  );
}

export function CallControls({ callEmbed }: CallControlsProps) {
  const [redesign] = useSetting(settingsAtom, 'callControlsRedesign');
  return redesign ? (
    <RedesignedCallControls callEmbed={callEmbed} />
  ) : (
    <ClassicCallControls callEmbed={callEmbed} />
  );
}
