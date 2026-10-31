import { FormEventHandler, useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Button, color, config, Dialog, Spinner, Text } from 'folds';
import { createClient, LoginRequest, MatrixClient, MatrixError } from 'matrix-js-sdk';
import { LoginFlow } from 'matrix-js-sdk/lib/@types/auth';
import { SplashScreen } from '../../components/splash-screen';
import { PasswordInput } from '../../components/password-input';
import { AsyncStatus, useAsyncCallback } from '../../hooks/useAsyncCallback';
import { getPasswordFlow, getSSOFlow, getTokenFlow } from '../../hooks/useParsedLoginFlows';
import { CustomLoginResponse, login, LoginError } from '../auth/login/loginUtil';
import { setFallbackSession } from '../../state/sessions';
import { logoutClient } from '../../../client/initMatrix';

const LOGIN_TOKEN_PARAM = 'loginToken';

const appRootUrl = () => `${window.location.origin}${window.location.pathname}`;

const loginErrorMessage = (error: MatrixError): string => {
  switch (error.errcode) {
    case LoginError.Forbidden:
      return 'Invalid password.';
    case LoginError.UserDeactivated:
      return 'This account has been deactivated.';
    case LoginError.RateLimited:
      return 'Too many attempts. Wait a moment and try again.';
    case LoginError.InvalidRequest:
      return 'The homeserver rejected the sign-in request.';
    default:
      return 'Failed to sign in. Check your connection and try again.';
  }
};

type SoftLogoutProps = {
  mx: MatrixClient;
};

/**
 * Shown when the homeserver invalidates our access token with `soft_logout: true`.
 *
 * A soft logout keeps the device on the server, so the right response is to sign in again with
 * the same `device_id` and carry on with the sync store and crypto store untouched. Wiping them,
 * which is what a hard logout does, destroys every room key that isn't in key backup.
 */
export function SoftLogout({ mx }: SoftLogoutProps) {
  const baseUrl = mx.getHomeserverUrl();
  const userId = mx.getSafeUserId();
  const deviceId = mx.getDeviceId() ?? undefined;
  const authClient = useMemo(() => createClient({ baseUrl }), [baseUrl]);

  const [flows, setFlows] = useState<LoginFlow[]>();
  const [flowsError, setFlowsError] = useState(false);

  useEffect(() => {
    authClient
      .loginFlows()
      .then((res) => setFlows(res.flows))
      .catch(() => setFlowsError(true));
  }, [authClient]);

  const [loginState, startLogin] = useAsyncCallback<
    CustomLoginResponse,
    MatrixError,
    [LoginRequest]
  >(
    useCallback(
      async (data) => {
        const res = await login(baseUrl, { ...data, device_id: deviceId });
        const { response } = res;
        if (response.user_id !== userId) {
          throw new MatrixError({ errcode: LoginError.Forbidden });
        }

        // The stores belong to this device. If the server handed out a different one, the old
        // device is gone after all, and its crypto store can't be reused by the new device.
        if (response.device_id !== deviceId) {
          await mx.clearStores();
        }

        setFallbackSession(response.access_token, response.device_id, response.user_id, baseUrl);
        window.location.replace(appRootUrl());
        return res;
      },
      [mx, baseUrl, userId, deviceId],
    ),
  );

  const loginToken = useMemo(
    () => new URLSearchParams(window.location.search).get(LOGIN_TOKEN_PARAM) ?? undefined,
    [],
  );
  useEffect(() => {
    if (!loginToken) return;
    startLogin({ type: 'm.login.token', token: loginToken });
  }, [loginToken, startLogin]);

  const passwordFlow = flows && getPasswordFlow(flows);
  const ssoFlow = flows && getTokenFlow(flows) ? getSSOFlow(flows) : undefined;
  const signingIn =
    loginState.status === AsyncStatus.Loading || loginState.status === AsyncStatus.Success;

  const handleSubmit: FormEventHandler<HTMLFormElement> = (evt) => {
    evt.preventDefault();
    if (signingIn) return;
    const { passwordInput } = evt.target as HTMLFormElement & {
      passwordInput: HTMLInputElement;
    };
    const password = passwordInput.value;
    if (!password) {
      passwordInput.focus();
      return;
    }
    startLogin({
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: userId },
      password,
    });
  };

  const [signingOut, setSigningOut] = useState(false);
  const handleSignOut = () => {
    setSigningOut(true);
    logoutClient(mx);
  };

  return (
    <SplashScreen>
      <Box direction="Column" grow="Yes" alignItems="Center" justifyContent="Center" gap="400">
        <Dialog>
          <Box
            as="form"
            onSubmit={handleSubmit}
            direction="Column"
            gap="400"
            style={{ padding: config.space.S400, maxWidth: 400 }}
          >
            <Box direction="Column" gap="100">
              <Text size="H4">Session expired</Text>
              <Text size="T300">
                The homeserver signed this session out. Sign in again as <b>{userId}</b> to pick up
                where you left off; your messages and encryption keys on this device are kept.
              </Text>
            </Box>

            {!flows && !flowsError && !loginToken && <Spinner variant="Secondary" size="400" />}
            {flowsError && (
              <Text size="T200" style={{ color: color.Critical.Main }}>
                Could not reach the homeserver. Check your connection and reload.
              </Text>
            )}

            {passwordFlow && (
              <Box direction="Column" gap="100">
                <Text size="L400">Password</Text>
                <PasswordInput name="passwordInput" size="400" readOnly={signingIn} />
              </Box>
            )}
            {passwordFlow && (
              <Button
                type="submit"
                disabled={signingIn}
                before={signingIn && <Spinner size="200" variant="Primary" fill="Solid" />}
              >
                <Text as="span" size="B400">
                  Sign in again
                </Text>
              </Button>
            )}
            {ssoFlow && !signingIn && (
              <Button
                as="a"
                variant="Secondary"
                href={authClient.getSsoLoginUrl(
                  appRootUrl(),
                  ssoFlow.type === 'm.login.cas' ? 'cas' : 'sso',
                )}
              >
                <Text as="span" size="B400">
                  Sign in with single sign-on
                </Text>
              </Button>
            )}
            {loginToken && signingIn && !passwordFlow && (
              <Box alignItems="Center" gap="200">
                <Spinner variant="Secondary" size="200" />
                <Text size="T300">Signing in...</Text>
              </Box>
            )}
            {loginState.status === AsyncStatus.Error && (
              <Text size="T200" style={{ color: color.Critical.Main }}>
                {loginErrorMessage(loginState.error)}
              </Text>
            )}

            <Button
              type="button"
              variant="Critical"
              fill="None"
              onClick={handleSignOut}
              disabled={signingOut || signingIn}
            >
              <Text as="span" size="B400">
                Sign out and clear this device instead
              </Text>
            </Button>
          </Box>
        </Dialog>
      </Box>
    </SplashScreen>
  );
}
