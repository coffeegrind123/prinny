import { FormEventHandler, useCallback, useEffect, useState } from 'react';
import { Box, Button, Chip, Icon, Icons, Input, Spinner, Text, color, config } from 'folds';
import { AuthDict, IAuthData, IThreepid, MatrixError, UIAFlow } from 'matrix-js-sdk';
import { SequenceCard } from '../../../components/sequence-card';
import { SequenceCardStyle } from '../styles.css';
import { SettingTile } from '../../../components/setting-tile';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { ActionUIA, ActionUIAFlowsLoader } from '../../../components/ActionUIA';
import { errorMessage } from '../../../utils/errorMessage';

const randomClientSecret = (): string => {
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

type AddEmailProps = {
  onAdded: () => void;
};

/**
 * Adds an email address to the account.
 *
 * The flow is two-legged and easy to get wrong: ask the homeserver to send a
 * token, wait for the user to click the link in that mail, and only then call
 * `addThreePidOnly` — which is what actually attaches the address. Calling it
 * before the link is clicked fails, so the button that completes the process is
 * deliberately separate and explains what it is waiting for.
 */
function AddEmail({ onAdded }: AddEmailProps) {
  const mx = useMatrixClient();
  const [email, setEmail] = useState('');
  const [clientSecret, setClientSecret] = useState<string>();
  const [sid, setSid] = useState<string>();
  const [authData, setAuthData] = useState<IAuthData>();

  const [requestState, requestToken] = useAsyncCallback<void, MatrixError, [string]>(
    useCallback(
      async (address) => {
        const secret = randomClientSecret();
        const result = await mx.requestAdd3pidEmailToken(address, secret, 1);
        setClientSecret(secret);
        setSid(result.sid);
      },
      [mx],
    ),
  );

  const [addState, add] = useAsyncCallback<void, MatrixError, [AuthDict | undefined]>(
    useCallback(
      async (authDict) => {
        if (!clientSecret || !sid) return;
        try {
          await mx.addThreePidOnly({
            sid,
            client_secret: clientSecret,
            // The sdk types this narrower than the spec's AuthDict; the value
            // we pass through is whatever the UIA stage produced.
            auth: authDict as { type: string; session?: string } | undefined,
          });
          setEmail('');
          setSid(undefined);
          setClientSecret(undefined);
          setAuthData(undefined);
          onAdded();
        } catch (e) {
          const error = e as MatrixError;
          if (error.httpStatus === 401 && error.data?.flows) {
            setAuthData(error.data as IAuthData);
            return;
          }
          throw error;
        }
      },
      [mx, clientSecret, sid, onAdded],
    ),
  );

  const handleRequest: FormEventHandler<HTMLFormElement> = (evt) => {
    evt.preventDefault();
    if (!email.trim()) return;
    requestToken(email.trim());
  };

  return (
    <Box as="form" onSubmit={handleRequest} direction="Column" gap="300">
      <Box direction="Column" gap="100">
        <Text size="L400">Add Email Address</Text>
        <Box gap="200">
          {/* `direction="Column"` is load-bearing, not decoration. folds' Input
              is a flex *item* here with no width of its own, so in a row it
              shrinks to its content and leaves the rest of the row empty — the
              add-email field was visibly narrower than the display-name field
              for exactly this reason. A column container stretches it to the
              full width instead, which is what Profile already does.

              `variant="Secondary"` for the same consistency reason: Background
              resolves to the *page* background colour, so the field read as a
              black hole inside a SurfaceVariant card while every other settings
              input used Secondary. */}
          <Box grow="Yes" direction="Column">
            <Input
              value={email}
              onChange={(evt) => setEmail(evt.currentTarget.value)}
              type="email"
              variant="Secondary"
              size="400"
              radii="300"
              placeholder="you@example.com"
              disabled={!!sid}
            />
          </Box>
          <Button
            type="submit"
            variant="Secondary"
            fill="Soft"
            size="400"
            radii="300"
            outlined
            disabled={!email.trim() || !!sid || requestState.status === AsyncStatus.Loading}
            before={
              requestState.status === AsyncStatus.Loading ? (
                <Spinner size="200" variant="Secondary" />
              ) : undefined
            }
          >
            <Text size="B400">Send link</Text>
          </Button>
        </Box>
      </Box>

      {requestState.status === AsyncStatus.Error && (
        <Text size="T200" style={{ color: color.Critical.Main }}>
          {errorMessage(requestState.error, 'Could not send the verification email.')}
        </Text>
      )}

      {sid && (
        <Box direction="Column" gap="200">
          <Text size="T200" priority="300">
            Check your inbox and click the link, then finish here.
          </Text>
          {addState.status === AsyncStatus.Error && (
            <Text size="T200" style={{ color: color.Critical.Main }}>
              {errorMessage(
                addState.error,
                'Could not add the address. If you have not clicked the link yet, do that first.',
              )}
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
                  action={(authDict) => add(authDict)}
                  onCancel={() => setAuthData(undefined)}
                />
              )}
            </ActionUIAFlowsLoader>
          )}
          <Box gap="200">
            <Button
              type="button"
              variant="Primary"
              size="300"
              radii="300"
              onClick={() => add(undefined)}
              disabled={addState.status === AsyncStatus.Loading}
              before={
                addState.status === AsyncStatus.Loading ? (
                  <Spinner size="200" fill="Solid" variant="Primary" />
                ) : undefined
              }
            >
              <Text size="B300">I have clicked the link</Text>
            </Button>
            <Button
              type="button"
              variant="Secondary"
              fill="None"
              size="300"
              radii="300"
              onClick={() => {
                setSid(undefined);
                setClientSecret(undefined);
              }}
            >
              <Text size="B300">Cancel</Text>
            </Button>
          </Box>
        </Box>
      )}
    </Box>
  );
}

export function ContactInformation() {
  const mx = useMatrixClient();

  const [threePIdsState, loadThreePIds] = useAsyncCallback(
    useCallback(() => mx.getThreePids(), [mx]),
  );
  const threePIds: IThreepid[] | undefined =
    threePIdsState.status === AsyncStatus.Success ? threePIdsState.data.threepids : undefined;

  const [removeState, remove] = useAsyncCallback<void, MatrixError, [string, string]>(
    useCallback(
      async (medium, address) => {
        await mx.deleteThreePid(medium, address);
        loadThreePIds();
      },
      [mx, loadThreePIds],
    ),
  );

  useEffect(() => {
    loadThreePIds();
  }, [loadThreePIds]);

  const emails = threePIds?.filter((id) => id.medium === 'email') ?? [];
  const phones = threePIds?.filter((id) => id.medium === 'msisdn') ?? [];

  return (
    <Box direction="Column" gap="100">
      <Text size="L400">Contact Information</Text>
      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="400"
      >
        <SettingTile
          title="Email Addresses"
          description="Used to reset your password, and to let people find you if you have an identity server set."
        >
          <Box direction="Column" gap="200" style={{ marginTop: config.space.S200 }}>
            {emails.length === 0 && (
              <Text size="T200" priority="300">
                No email address is attached to this account.
              </Text>
            )}
            {emails.map((threePId) => (
              <Box key={threePId.address} alignItems="Center" gap="200">
                <Box grow="Yes">
                  <Chip as="span" variant="Secondary" radii="Pill">
                    <Text size="T200">{threePId.address}</Text>
                  </Chip>
                </Box>
                <Button
                  size="300"
                  radii="300"
                  variant="Critical"
                  fill="None"
                  onClick={() => remove(threePId.medium, threePId.address)}
                  disabled={removeState.status === AsyncStatus.Loading}
                  before={<Icon size="50" src={Icons.Delete} />}
                >
                  <Text size="B300">Remove</Text>
                </Button>
              </Box>
            ))}

            {removeState.status === AsyncStatus.Error && (
              <Text size="T200" style={{ color: color.Critical.Main }}>
                {errorMessage(removeState.error, 'Could not remove that address.')}
              </Text>
            )}
          </Box>

          {/* `direction="Column"` on the spacer, not just inside AddEmail.
              folds' Box defaults to `display: flex` with no direction, i.e. a
              ROW — so this wrapper made the whole add-email form a row flex
              item, which sizes to its content. Every `grow="Yes"` inside it was
              then growing within a box that had already collapsed to the width
              of the placeholder plus the button, which is why the field stayed
              visibly narrower than the identity-server one despite the two
              having identical internals. A column container stretches its child
              to full width; the identity-server form gets there by not being
              wrapped in a row at all. */}
          <Box direction="Column" style={{ marginTop: config.space.S300 }}>
            <AddEmail onAdded={loadThreePIds} />
          </Box>
        </SettingTile>
      </SequenceCard>

      {phones.length > 0 && (
        <SequenceCard
          className={SequenceCardStyle}
          variant="SurfaceVariant"
          direction="Column"
          gap="400"
        >
          <SettingTile
            title="Phone Numbers"
            description="Adding a phone number needs an identity server and an SMS flow this client does not implement; existing numbers can still be removed."
          >
            <Box direction="Column" gap="200" style={{ marginTop: config.space.S200 }}>
              {phones.map((threePId) => (
                <Box key={threePId.address} alignItems="Center" gap="200">
                  <Box grow="Yes">
                    <Chip as="span" variant="Secondary" radii="Pill">
                      <Text size="T200">{threePId.address}</Text>
                    </Chip>
                  </Box>
                  <Button
                    size="300"
                    radii="300"
                    variant="Critical"
                    fill="None"
                    onClick={() => remove(threePId.medium, threePId.address)}
                    disabled={removeState.status === AsyncStatus.Loading}
                    before={<Icon size="50" src={Icons.Delete} />}
                  >
                    <Text size="B300">Remove</Text>
                  </Button>
                </Box>
              ))}
            </Box>
          </SettingTile>
        </SequenceCard>
      )}
    </Box>
  );
}
