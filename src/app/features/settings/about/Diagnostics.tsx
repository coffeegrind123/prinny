import { useState } from 'react';
import { Box, Button, Text, config } from 'folds';
import { SequenceCard } from '../../../components/sequence-card';
import { SequenceCardStyle } from '../styles.css';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useServerSoftware } from '../../../hooks/useServerSoftware';
import { useIsAndroid } from '../../../hooks/useIsAndroid';
import { useOwnDeviceKeysReport } from '../../../../client/deviceKeysCheck';
import { readFocusRepairs } from '../../../utils/composerFocusRepairs';
import { isTauri } from '../../../utils/desktop-notifications';
import { copyToClipboard } from '../../../utils/dom';
import { formatDiagnostics } from './diagnosticsReport';
import { version } from '../../../../../package.json';

export function Diagnostics() {
  const mx = useMatrixClient();
  const server = useServerSoftware();
  const android = useIsAndroid();
  const keys = useOwnDeviceKeysReport();
  // Read when the page opens: a repair needs the composer, which this page covers.
  const [repairs] = useState(readFocusRepairs);
  const [copied, setCopied] = useState<boolean>();

  let platform = 'web';
  if (android) platform = 'Android app';
  else if (isTauri()) platform = 'desktop app';

  const lines = formatDiagnostics({
    version,
    commit: __APP_COMMIT__ || undefined,
    platform,
    userAgent: navigator.userAgent,
    homeserver: mx.baseUrl,
    serverName: server.name,
    serverVersion: server.version,
    userId: mx.getSafeUserId(),
    deviceId: mx.getDeviceId() ?? undefined,
    keys,
    repairs,
  });

  const handleCopy = async () => setCopied(await copyToClipboard(lines.join('\n')));

  return (
    <Box direction="Column" gap="100">
      <Text size="L400">Diagnostics</Text>
      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="400"
      >
        <Text size="T200" priority="300">
          For bug reports about encryption, verification or typing. Contains no messages or keys
          that could decrypt them; the fingerprints are public.
        </Text>
        <Box
          as="pre"
          direction="Column"
          style={{
            margin: 0,
            fontFamily: 'monospace',
            fontSize: config.fontSize.T200,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {lines.join('\n')}
        </Box>
        <Box gap="200" alignItems="Center">
          <Button onClick={handleCopy} variant="Secondary" fill="Soft" size="300" radii="300">
            <Text size="B300">Copy</Text>
          </Button>
          {copied !== undefined && (
            <Text size="T200">{copied ? 'Copied.' : 'Could not copy; take a screenshot.'}</Text>
          )}
        </Box>
      </SequenceCard>
    </Box>
  );
}
