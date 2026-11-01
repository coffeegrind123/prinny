import { FormEventHandler, useCallback, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  Header,
  Icon,
  IconButton,
  Icons,
  Input,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Spinner,
  Text,
  color,
  config,
} from 'folds';
import { FocusTrap } from 'focus-trap-react';
import { AuthDict, IAuthData, MatrixError, UIAFlow } from 'matrix-js-sdk';
import { SequenceCard } from '../../../components/sequence-card';
import { SequenceCardStyle } from '../styles.css';
import { SettingTile } from '../../../components/setting-tile';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { ActionUIA, ActionUIAFlowsLoader } from '../../../components/ActionUIA';
import { stopPropagation } from '../../../utils/keyboard';
import { clearClientStores } from '../../../../client/initMatrix';
import { errorMessage } from '../../../utils/errorMessage';

/**
 * Account deactivation.
 *
 * The confirmation asks the user to type their own Matrix ID rather than
 * offering a plain "yes" button. This is irreversible, the id cannot be
 * reclaimed afterwards, and it is the one action in the client where an
 * accidental click cannot be undone by anyone — not by us, not by the server
 * admin.
 */
function DeactivateDialog({ requestClose }: { requestClose: () => void }) {
  const mx = useMatrixClient();
  const userId = mx.getSafeUserId();

  const [typed, setTyped] = useState('');
  const [eraseMessages, setEraseMessages] = useState(false);
  const [authData, setAuthData] = useState<IAuthData>();

  const [state, deactivate] = useAsyncCallback<void, MatrixError, [AuthDict | undefined]>(
    useCallback(
      async (authDict) => {
        try {
          await mx.deactivateAccount(authDict, eraseMessages);
          // The session is gone server-side; drop the local one too rather than
          // leaving a client running against a dead account.
          mx.stopClient();
          await clearClientStores(mx);
          window.localStorage.clear();
          window.location.reload();
        } catch (e) {
          const error = e as MatrixError;
          if (error.httpStatus === 401 && error.data?.flows) {
            setAuthData(error.data as IAuthData);
            return;
          }
          throw error;
        }
      },
      [mx, eraseMessages],
    ),
  );

  const confirmed = typed.trim() === userId;
  const busy = state.status === AsyncStatus.Loading;

  const handleSubmit: FormEventHandler<HTMLFormElement> = (evt) => {
    evt.preventDefault();
    if (!confirmed) return;
    deactivate(undefined);
  };

  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            clickOutsideDeactivates: true,
            onDeactivate: requestClose,
            escapeDeactivates: stopPropagation,
          }}
        >
          <Dialog variant="Surface">
            <Header
              style={{
                padding: `0 ${config.space.S200} 0 ${config.space.S400}`,
                borderBottomWidth: config.borderWidth.B300,
              }}
              variant="Surface"
              size="500"
            >
              <Box grow="Yes">
                <Text size="H4">Deactivate Account</Text>
              </Box>
              <IconButton size="300" onClick={requestClose} radii="300">
                <Icon src={Icons.Cross} />
              </IconButton>
            </Header>

            <Box
              as="form"
              onSubmit={handleSubmit}
              style={{ padding: config.space.S400 }}
              direction="Column"
              gap="400"
            >
              <Text size="T300" priority="400">
                This cannot be undone. Your account is closed, your user ID can never be used again,
                and you are removed from every room you are in. Messages you have already sent stay
                in those rooms.
              </Text>

              <SettingTile
                title="Also hide my messages"
                description="Asks the server to redact everything you have sent. Servers are not required to honour this, and copies already held by other servers are beyond its reach."
                before={
                  <Checkbox
                    variant="Critical"
                    size="300"
                    checked={eraseMessages}
                    onClick={() => setEraseMessages((v) => !v)}
                  />
                }
              />

              <Box direction="Column" gap="100">
                <Text size="L400">{`Type ${userId} to confirm`}</Text>
                <Input
                  value={typed}
                  onChange={(evt) => setTyped(evt.currentTarget.value)}
                  variant="Secondary"
                  size="400"
                  radii="300"
                  autoComplete="off"
                />
              </Box>

              {state.status === AsyncStatus.Error && (
                <Text size="T200" style={{ color: color.Critical.Main }}>
                  {errorMessage(state.error, 'Could not deactivate the account.')}
                </Text>
              )}

              {authData && (
                <ActionUIAFlowsLoader
                  authData={authData}
                  unsupported={() => (
                    <Text size="T200" style={{ color: color.Critical.Main }}>
                      Your server requires an authentication step this client does not support.
                    </Text>
                  )}
                >
                  {(ongoingFlow: UIAFlow) => (
                    <ActionUIA
                      authData={authData}
                      ongoingFlow={ongoingFlow}
                      action={(authDict) => deactivate(authDict)}
                      onCancel={() => setAuthData(undefined)}
                    />
                  )}
                </ActionUIAFlowsLoader>
              )}

              <Button
                type="submit"
                variant="Critical"
                disabled={!confirmed || busy}
                before={busy ? <Spinner fill="Solid" variant="Critical" size="200" /> : undefined}
              >
                <Text size="B400">Deactivate my account</Text>
              </Button>
            </Box>
          </Dialog>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}

export function DeactivateAccount() {
  const [open, setOpen] = useState(false);

  return (
    <Box direction="Column" gap="100">
      <Text size="L400">Danger Zone</Text>
      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="400"
      >
        <SettingTile
          title="Deactivate Account"
          description="Permanently close this account. There is no way back."
          after={
            <Button
              variant="Critical"
              fill="Soft"
              size="300"
              radii="300"
              outlined
              onClick={() => setOpen(true)}
            >
              <Text size="B300">Deactivate</Text>
            </Button>
          }
        />
      </SequenceCard>
      {open && <DeactivateDialog requestClose={() => setOpen(false)} />}
    </Box>
  );
}
