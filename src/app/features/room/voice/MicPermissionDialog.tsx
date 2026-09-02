import { forwardRef } from 'react';
import { Box, Button, Dialog, Header, Spinner, Text, color, config } from 'folds';
import { MicrophonePermission } from '../../../hooks/useMicrophonePermission';

type MicPermissionDialogProps = {
  permission: MicrophonePermission;
  onAllow: () => void;
  onClose: () => void;
};

/**
 * Asked before the system is, the first time someone records a voice message.
 *
 * The platform prompt on its own arrives with no context — Android's is a bare
 * "Allow Prinny to record audio?" raised by the WebView the instant capture is
 * attempted — and it is the one prompt a user only gets asked once. Saying no
 * to it is close to permanent, so it is worth spending a dialog to say what the
 * microphone is for before spending the single chance to ask.
 *
 * It is also the only place a "denied" state can be explained — but "denied"
 * does NOT retire the button. A single no is not final on the platform this
 * matters most on: Android re-raises its runtime dialog on the next
 * `getUserMedia` until the user has refused twice, and the shells cannot tell
 * a first refusal from a permanent one. Removing the button on the first no
 * left the only recovery as a trip to system settings for a permission the
 * platform was still willing to ask about, so the button stays and system
 * settings is named as the fallback rather than the instruction.
 */
export const MicPermissionDialog = forwardRef<HTMLDivElement, MicPermissionDialogProps>(
  ({ permission, onAllow, onClose }, ref) => {
    const denied = permission.state === 'denied';

    return (
      <Dialog variant="Surface" ref={ref}>
        <Header
          style={{
            padding: `0 ${config.space.S200} 0 ${config.space.S400}`,
            borderBottomWidth: config.borderWidth.B300,
          }}
          variant="Surface"
          size="500"
        >
          <Box grow="Yes">
            <Text size="H4">Microphone access</Text>
          </Box>
        </Header>
        <Box style={{ padding: config.space.S400 }} direction="Column" gap="400">
          <Text priority="400" size="T300">
            {denied
              ? 'Prinny was refused the microphone. Try again to ask once more — if no prompt appears, the refusal is on file and you will need to allow Prinny the microphone in your system settings.'
              : 'Prinny needs your microphone to record voice messages. It is opened only while you are recording, and released as soon as you send or discard the take.'}
          </Text>
          {permission.error && (
            <Text style={{ color: color.Critical.Main }} size="T200">
              {permission.error}
            </Text>
          )}
          <Box direction="Column" gap="200">
            <Button
              variant="Primary"
              onClick={onAllow}
              disabled={permission.requesting}
              before={permission.requesting ? <Spinner variant="Primary" size="200" /> : undefined}
            >
              <Text size="B400">{denied ? 'Ask again' : 'Allow microphone'}</Text>
            </Button>
            <Button variant="Secondary" fill="Soft" outlined onClick={onClose}>
              <Text size="B400">{denied ? 'Close' : 'Not now'}</Text>
            </Button>
          </Box>
        </Box>
      </Dialog>
    );
  },
);
