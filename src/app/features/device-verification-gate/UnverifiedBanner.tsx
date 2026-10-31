import { Box, Button, Icon, Icons, Text } from 'folds';
import * as css from './UnverifiedBanner.css';
import { GateKind, pendingKind, reopenGate } from './verificationGate';
import { useVerificationGateState } from './useVerificationGateState';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';

const COPY: Record<GateKind, { lead: string; rest: string; action: string }> = {
  verify: {
    lead: 'This device is unverified.',
    rest: 'Older messages stay locked and people you chat with see it as unverified.',
    action: 'Verify now',
  },
  setup: {
    lead: 'Recovery is not set up.',
    rest: 'If you sign out or lose this device, your encrypted messages cannot be restored.',
    action: 'Set up now',
  },
};

/** Stays visible after a skip so the choice is never silent, and puts the step one click away. */
function Banner() {
  const { userId, deviceId, identity, status, dismissed } = useVerificationGateState();

  // While the gate is open it already says this, so the banner only covers the skipped case.
  const kind = pendingKind({ identity, status });
  if (!kind || !dismissed[kind]) return null;

  const { lead, rest, action } = COPY[kind];
  return (
    <Box className={css.UnverifiedBanner} role="status">
      <Icon size="200" src={Icons.ShieldUser} />
      <Box grow="Yes">
        <Text size="T300">
          <b>{lead}</b> {rest}
        </Text>
      </Box>
      <Button
        variant="Warning"
        size="300"
        radii="300"
        onClick={() => deviceId && reopenGate(kind, userId, deviceId)}
      >
        <Text as="span" size="B300">
          {action}
        </Text>
      </Button>
    </Box>
  );
}

export function UnverifiedBanner() {
  const [verifyAfterSignIn] = useSetting(settingsAtom, 'verifyAfterSignIn');
  return verifyAfterSignIn ? <Banner /> : null;
}
