import { FormEventHandler, useCallback, useState } from 'react';
import { Box, Button, Checkbox, Spinner, Text, color, config } from 'folds';
import { MatrixError } from 'matrix-js-sdk';
import { SequenceCard } from '../../../components/sequence-card';
import { SequenceCardStyle } from '../styles.css';
import { SettingTile } from '../../../components/setting-tile';
import { PasswordInput } from '../../../components/password-input';
import { ConfirmPasswordMatch } from '../../../components/ConfirmPasswordMatch';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { errorMessage } from '../../../utils/errorMessage';

/**
 * Change the account password.
 *
 * There was no way to do this without logging out and using the reset flow,
 * which meant "change my password" required access to the email on the account.
 *
 * `setPassword` takes the old password as the auth dict directly, so this needs
 * none of the interactive-auth machinery — the server either accepts the old
 * password or it does not.
 */
export function ChangePassword() {
  const mx = useMatrixClient();
  const [logoutDevices, setLogoutDevices] = useState(false);
  const [done, setDone] = useState(false);

  const [state, changePassword] = useAsyncCallback<void, MatrixError, [string, string, boolean]>(
    useCallback(
      async (oldPassword, newPassword, logoutAll) => {
        await mx.setPassword(
          {
            type: 'm.login.password',
            identifier: {
              type: 'm.id.user',
              user: mx.getSafeUserId(),
            },
            user: mx.getSafeUserId(),
            password: oldPassword,
          },
          newPassword,
          logoutAll,
        );
      },
      [mx],
    ),
  );

  const changing = state.status === AsyncStatus.Loading;

  const handleSubmit: FormEventHandler<HTMLFormElement> = (evt) => {
    evt.preventDefault();
    const form = evt.currentTarget;
    const oldPassword = (form.elements.namedItem('oldPassword') as HTMLInputElement).value;
    const newPassword = (form.elements.namedItem('newPassword') as HTMLInputElement).value;
    if (!oldPassword || !newPassword) return;

    setDone(false);
    changePassword(oldPassword, newPassword, logoutDevices).then(() => {
      setDone(true);
      form.reset();
    });
  };

  return (
    <Box direction="Column" gap="100">
      <Text size="L400">Password</Text>
      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="400"
      >
        <SettingTile
          title="Change Password"
          description="You will stay signed in on this device."
        />
        <Box as="form" onSubmit={handleSubmit} direction="Column" gap="400">
          <Box direction="Column" gap="100">
            <Text size="L400">Current Password</Text>
            <PasswordInput
              name="oldPassword"
              size="400"
              radii="300"
              required
              autoComplete="current-password"
            />
          </Box>

          <ConfirmPasswordMatch initialValue={false}>
            {(match, doMatch, passRef, confPassRef) => (
              <>
                <Box direction="Column" gap="100">
                  <Text size="L400">New Password</Text>
                  <PasswordInput
                    ref={passRef}
                    name="newPassword"
                    size="400"
                    radii="300"
                    onChange={doMatch}
                    required
                    autoComplete="new-password"
                  />
                </Box>
                <Box direction="Column" gap="100">
                  <Text size="L400">Confirm New Password</Text>
                  <PasswordInput
                    ref={confPassRef}
                    name="confirmPassword"
                    size="400"
                    radii="300"
                    onChange={doMatch}
                    required
                    autoComplete="new-password"
                  />
                  {!match && (
                    <Text size="T200" priority="300">
                      Both passwords must match before you can continue.
                    </Text>
                  )}
                </Box>

                <SettingTile
                  title="Sign out of all other devices"
                  description="Anyone using your account elsewhere will have to sign in again. Note that this loses any encryption keys those devices hold that were never backed up."
                  before={
                    <Checkbox
                      variant="Primary"
                      size="300"
                      checked={logoutDevices}
                      onClick={() => setLogoutDevices((v) => !v)}
                    />
                  }
                />

                {state.status === AsyncStatus.Error && (
                  <Text size="T200" style={{ color: color.Critical.Main }}>
                    {errorMessage(state.error, 'Could not change your password.')}
                  </Text>
                )}
                {done && state.status === AsyncStatus.Success && (
                  <Text size="T200" style={{ color: color.Success.Main }}>
                    Your password has been changed.
                  </Text>
                )}

                <Box>
                  <Button
                    type="submit"
                    variant="Primary"
                    size="400"
                    radii="300"
                    disabled={!match || changing}
                    before={
                      changing ? <Spinner fill="Solid" variant="Primary" size="200" /> : undefined
                    }
                    style={{ marginTop: config.space.S100 }}
                  >
                    <Text size="B400">Change Password</Text>
                  </Button>
                </Box>
              </>
            )}
          </ConfirmPasswordMatch>
        </Box>
      </SequenceCard>
    </Box>
  );
}
