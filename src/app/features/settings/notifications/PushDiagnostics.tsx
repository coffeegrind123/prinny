import { useCallback, useEffect } from 'react';
import { Box, Button, Icon, Icons, Spinner, Text, color } from 'folds';
import { SequenceCard } from '../../../components/sequence-card';
import { SequenceCardStyle } from '../styles.css';
import { SettingTile } from '../../../components/setting-tile';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import {
  getUnifiedPushStatus,
  registerUnifiedPush,
  type UnifiedPushStatus,
} from '../../../utils/mobile-push';
import { registerMatrixPusher, type PusherRegistration } from '../../../hooks/useUnifiedPush';
import { useIsAndroid } from '../../../hooks/useIsAndroid';

/** Must match `UP_APP_ID` in `hooks/useUnifiedPush.ts`. */
const UP_APP_ID = 'in.prinny.app.unifiedpush';

const DISTRIBUTOR_HELP_URL = 'https://unifiedpush.org/users/distributors/';

type Health = 'ok' | 'bad' | 'unknown';

type Check = {
  label: string;
  health: Health;
  /** What is actually true, in the device's own words. */
  detail: string;
  /** What to do about it. Absent when there is nothing to do. */
  fix?: string;
};

const HealthIcon = ({ health }: { health: Health }) => {
  if (health === 'ok') {
    return <Icon size="100" src={Icons.Check} style={{ color: color.Success.Main }} />;
  }
  if (health === 'bad') {
    return <Icon size="100" src={Icons.Warning} style={{ color: color.Critical.Main }} />;
  }
  return <Icon size="100" src={Icons.Info} style={{ color: color.Warning.Main }} />;
};

/**
 * Turn the device state and the homeserver's pusher list into the five links of
 * the push chain, each with its own verdict.
 *
 * They are reported separately rather than as one "push: broken" because they
 * fail independently and their fixes have nothing in common: installing an app,
 * choosing it, waiting on a handshake, re-registering with the homeserver, and
 * granting an Android permission. A single verdict sends the user to look at
 * whichever one they happen to think of first.
 */
function buildChecks(status: UnifiedPushStatus, pusherEndpoints: string[] | undefined): Check[] {
  const { distributors, savedDistributor, ackDistributor, endpoint, notificationsPermitted } =
    status;

  const checks: Check[] = [];

  checks.push(
    distributors.length > 0
      ? {
          label: 'Distributor installed',
          health: 'ok',
          detail: distributors.join(', '),
        }
      : {
          label: 'Distributor installed',
          health: 'bad',
          detail: 'None found on this device.',
          // The whole chain starts here, and this is by far the most common
          // reason Android has no notifications: without a distributor there is
          // no push at all, and nothing else below can be true.
          fix: `Prinny has no Google/FCM path, so a UnifiedPush distributor app is required. Install ntfy, Sunup or NextPush, then use Re-register below. See ${DISTRIBUTOR_HELP_URL}`,
        },
  );

  checks.push(
    savedDistributor
      ? { label: 'Distributor selected', health: 'ok', detail: savedDistributor }
      : {
          label: 'Distributor selected',
          health: distributors.length > 0 ? 'bad' : 'unknown',
          detail: 'None selected.',
          fix: 'Use Re-register below and pick one when Android asks.',
        },
  );

  checks.push(
    ackDistributor
      ? { label: 'Distributor responded', health: 'ok', detail: ackDistributor }
      : {
          label: 'Distributor responded',
          health: savedDistributor ? 'bad' : 'unknown',
          detail: 'No handshake completed.',
          fix: 'The distributor app is installed but never answered. Open it, check it is connected to its server, then Re-register.',
        },
  );

  checks.push(
    endpoint
      ? { label: 'Push endpoint issued', health: 'ok', detail: endpoint }
      : {
          label: 'Push endpoint issued',
          health: ackDistributor ? 'bad' : 'unknown',
          detail: 'No endpoint on this device.',
        },
  );

  if (pusherEndpoints === undefined) {
    checks.push({
      label: 'Homeserver pusher',
      health: 'unknown',
      detail: 'Could not read the pusher list from the homeserver.',
    });
  } else if (!endpoint) {
    checks.push({
      label: 'Homeserver pusher',
      health: 'unknown',
      detail: `${pusherEndpoints.length} registered for this app.`,
    });
  } else if (pusherEndpoints.includes(endpoint)) {
    checks.push({
      label: 'Homeserver pusher',
      health: 'ok',
      detail: 'Registered against this endpoint.',
    });
  } else {
    checks.push({
      label: 'Homeserver pusher',
      health: 'bad',
      // The silent failure: everything on the device looks healthy while the
      // homeserver pushes at an endpoint the distributor has already retired.
      detail:
        pusherEndpoints.length > 0
          ? 'Registered, but against a different (retired) endpoint.'
          : 'No pusher registered for this app.',
      fix: 'Use Re-register below — the homeserver is sending notifications somewhere this device no longer listens.',
    });
  }

  checks.push(
    notificationsPermitted
      ? { label: 'Android may notify', health: 'ok', detail: 'POST_NOTIFICATIONS granted.' }
      : {
          label: 'Android may notify',
          health: 'bad',
          detail: 'POST_NOTIFICATIONS denied.',
          // Worth spelling out: pushes still arrive and are still processed, so
          // every other check here can read green while nothing is ever shown.
          fix: 'Every notification is silently dropped by Android, including ones that arrive correctly. Grant notifications for Prinny in Android Settings → Apps.',
        },
  );

  return checks;
}

/**
 * Android push diagnostics.
 *
 * Prinny reaches Android through UnifiedPush rather than FCM, which means push
 * depends on a second app the user installs themselves and on a pusher held by
 * the homeserver. Neither was visible anywhere in the UI, so any break in that
 * chain presented identically — as "notifications don't work" — with the only
 * evidence a console warning inside a WebView on a phone.
 *
 * Element X ships a notification troubleshooting screen for the same reason,
 * and FluffyChat prompts for a distributor outright.
 */
export function PushDiagnostics() {
  const mx = useMatrixClient();
  const android = useIsAndroid();

  const [state, refresh] = useAsyncCallback(
    useCallback(async () => {
      const status = await getUnifiedPushStatus();
      if (!status) return undefined;
      // A failure here is reported as "unknown", not as a missing pusher: the
      // two look identical from a caller that swallows the error, and only one
      // of them is a fault worth sending the user after.
      let pusherEndpoints: string[] | undefined;
      try {
        const { pushers } = await mx.getPushers();
        pusherEndpoints = pushers
          .filter((pusher) => pusher.app_id === UP_APP_ID)
          .map((pusher) => pusher.pushkey);
      } catch {
        pusherEndpoints = undefined;
      }
      return buildChecks(status, pusherEndpoints);
    }, [mx]),
  );

  const [reRegisterState, reRegister] = useAsyncCallback(
    useCallback(async () => {
      // Registering is what prompts Android to offer the distributor chooser
      // when more than one is installed, so this button doubles as the picker.
      await registerUnifiedPush();
    }, []),
  );

  /**
   * Register the pusher on demand, and report what the homeserver said.
   *
   * The automatic attempt happens once at startup and reports failure only to
   * the console — which on a phone is nowhere. So "Homeserver pusher" could sit
   * red with the cause sitting in a log nobody can open, and every cause looks
   * the same from the outside. This runs the same code path on demand and puts
   * the homeserver's own words on screen.
   */
  const [pusherState, registerPusher] = useAsyncCallback(
    useCallback(async (): Promise<PusherRegistration> => {
      const status = await getUnifiedPushStatus();
      if (!status?.endpoint) {
        return {
          ok: false,
          reason: 'No endpoint on this device yet — use Re-register first.',
        };
      }
      return registerMatrixPusher(mx, status.endpoint);
    }, [mx]),
  );

  useEffect(() => {
    if (pusherState.status === AsyncStatus.Success) refresh();
  }, [pusherState.status, refresh]);

  useEffect(() => {
    if (android) refresh();
  }, [android, refresh]);

  useEffect(() => {
    if (reRegisterState.status === AsyncStatus.Success) refresh();
  }, [reRegisterState.status, refresh]);

  // Desktop and web have their own push paths and none of these links exist
  // there, so the section is absent rather than empty.
  if (!android) return null;

  const checks = state.status === AsyncStatus.Success ? state.data : undefined;
  const loading = state.status === AsyncStatus.Loading;

  return (
    <Box direction="Column" gap="100">
      <Text size="L400">Push Delivery</Text>
      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="400"
      >
        <SettingTile
          title="Background notifications"
          description="Prinny uses UnifiedPush on Android, which needs a distributor app on the device and a pusher on your homeserver. Each step below is checked separately."
        />
        {loading && !checks && (
          <Box alignItems="Center" gap="200">
            <Spinner size="100" />
            <Text size="T200">Checking…</Text>
          </Box>
        )}
        {checks?.map((check) => (
          <Box key={check.label} direction="Column" gap="100">
            <Box alignItems="Center" gap="200">
              <HealthIcon health={check.health} />
              <Text size="T300">{check.label}</Text>
            </Box>
            {/*
              `wordBreak` because an endpoint is a long unbroken URL and a phone
              is narrow: without it the value decides the width of the settings
              page and pushes everything else off screen.
            */}
            <Text size="T200" priority="300" style={{ wordBreak: 'break-all' }}>
              {check.detail}
            </Text>
            {check.fix && (
              <Text size="T200" style={{ color: color.Warning.Main }}>
                {check.fix}
              </Text>
            )}
          </Box>
        ))}
        {state.status === AsyncStatus.Error && (
          <Text size="T200" style={{ color: color.Critical.Main }}>
            Could not read the push state from this device.
          </Text>
        )}
        {reRegisterState.status === AsyncStatus.Error && (
          <Text size="T200" style={{ color: color.Critical.Main }}>
            {`${reRegisterState.error}`}
          </Text>
        )}
        {pusherState.status === AsyncStatus.Success && (
          <Box direction="Column" gap="100">
            <Text
              size="T200"
              style={{
                color: pusherState.data.ok ? color.Success.Main : color.Critical.Main,
                wordBreak: 'break-all',
              }}
            >
              {pusherState.data.ok
                ? 'The homeserver accepted the pusher.'
                : `The homeserver refused the pusher: ${pusherState.data.reason}`}
            </Text>
            {pusherState.data.gateway && (
              /*
                The gateway is shown because it is chosen silently and is not
                always the one you would assume. It is discovered by asking the
                push server whether it speaks Matrix, and that request is made
                from the WebView — so a push server that answers without CORS
                headers (ntfy.sh does exactly this on its gateway path) fails
                the check and everything falls back to the public gateway at
                matrix.gateway.unifiedpush.org. That still delivers, but it puts
                a third party in the path of every notification, so it should be
                visible rather than inferred.
              */
              <Text size="T200" priority="300" style={{ wordBreak: 'break-all' }}>
                {`Gateway in use: ${pusherState.data.gateway}`}
              </Text>
            )}
          </Box>
        )}
        {pusherState.status === AsyncStatus.Error && (
          <Text size="T200" style={{ color: color.Critical.Main }}>
            {`${pusherState.error}`}
          </Text>
        )}
        <Box gap="200">
          <Button
            size="300"
            variant="Secondary"
            fill="Soft"
            radii="300"
            onClick={() => reRegister()}
            disabled={reRegisterState.status === AsyncStatus.Loading}
            before={
              reRegisterState.status === AsyncStatus.Loading ? (
                <Spinner size="100" variant="Secondary" />
              ) : undefined
            }
          >
            <Text size="B300">Re-register</Text>
          </Button>
          <Button
            size="300"
            variant="Secondary"
            fill="Soft"
            radii="300"
            onClick={() => registerPusher()}
            disabled={pusherState.status === AsyncStatus.Loading}
            before={
              pusherState.status === AsyncStatus.Loading ? (
                <Spinner size="100" variant="Secondary" />
              ) : undefined
            }
          >
            <Text size="B300">Register pusher</Text>
          </Button>
          <Button
            size="300"
            variant="Secondary"
            fill="None"
            radii="300"
            onClick={() => refresh()}
            disabled={loading}
          >
            <Text size="B300">Refresh</Text>
          </Button>
        </Box>
      </SequenceCard>
    </Box>
  );
}
