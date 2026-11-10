import { Box, Button, config, Line, Spinner, Text } from 'folds';
import { MatrixClient } from 'matrix-js-sdk';
import { useOwnDeviceKeysMismatch } from '../../../client/deviceKeysCheck';
import { logoutClient } from '../../../client/initMatrix';
import { AsyncStatus, useAsyncCallback } from '../../hooks/useAsyncCallback';
import { ContainerColor } from '../../styles/ContainerColor.css';

/**
 * Shown when the homeserver holds different encryption keys for this session than the session
 * has (see `deviceKeysCheck`). Nothing in the session can repair that: the server will not take
 * new keys for an existing device, and the old private keys are gone. A new sign-in creates a
 * new device with fresh keys.
 */
export function DeviceKeysStatus({ mx }: { mx: MatrixClient }) {
  const mismatch = useOwnDeviceKeysMismatch();
  const [signOutState, signOut] = useAsyncCallback(() => logoutClient(mx));

  if (!mismatch) return null;

  const signingOut = signOutState.status === AsyncStatus.Loading;
  return (
    <Box direction="Column" shrink="No" role="alert">
      <Box
        className={ContainerColor({ variant: 'Critical' })}
        style={{ padding: `${config.space.S100} ${config.space.S300}` }}
        alignItems="Center"
        justifyContent="Center"
        gap="300"
        wrap="Wrap"
      >
        <Text size="L400" align="Center">
          This session lost its encryption keys, and your homeserver still has the old ones for it.
          New encrypted messages cannot be decrypted here, and it cannot be verified. Sign out and
          sign in again to fix it.
        </Text>
        <Button
          size="300"
          variant="Critical"
          fill="Solid"
          radii="300"
          onClick={() => signOut()}
          disabled={signingOut}
          before={signingOut && <Spinner size="100" variant="Critical" fill="Solid" />}
        >
          <Text size="B300">Sign Out</Text>
        </Button>
      </Box>
      <Line variant="Critical" size="300" />
    </Box>
  );
}
