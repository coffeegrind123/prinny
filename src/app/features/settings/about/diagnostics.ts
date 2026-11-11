import { DeviceKeysState, OwnDeviceKeysReport } from '../../../../client/deviceKeysCheck';
import { FocusRepairStats } from '../../../utils/composerFocusRepairs';

/**
 * Settings › About › Diagnostics: what a bug report about encryption or the composer needs, as
 * text a reader can screenshot or copy. On Android the console is out of reach without a PC.
 */
export type DiagnosticsInput = {
  version: string;
  commit?: string;
  platform: string;
  userAgent: string;
  homeserver: string;
  serverName?: string;
  serverVersion?: string;
  userId: string;
  deviceId?: string;
  keys: OwnDeviceKeysReport;
  repairs: FocusRepairStats;
};

// Enough of a key to tell two apart on a screenshot, short enough to read.
const FINGERPRINT_CHARS = 12;

const fingerprint = (key: string | undefined) => (key ? key.slice(0, FINGERPRINT_CHARS) : 'none');

const time = (ms: number) => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

const KEY_STATE_LABEL: Record<DeviceKeysState, string> = {
  [DeviceKeysState.Match]: 'match',
  [DeviceKeysState.Mismatch]: 'MISMATCH',
  [DeviceKeysState.NotUploaded]: 'not uploaded',
};

export const formatDiagnostics = (input: DiagnosticsInput): string[] => {
  const { keys, repairs } = input;
  const lines: string[] = [];

  lines.push(
    `App: v${input.version}${input.commit ? ` (${input.commit})` : ''}, ${input.platform}`,
  );
  lines.push(`Browser: ${input.userAgent}`);
  const software = input.serverName
    ? [input.serverName, input.serverVersion].filter(Boolean).join(' ')
    : 'software unknown';
  lines.push(`Homeserver: ${input.homeserver} (${software})`);
  lines.push(`Device: ${input.deviceId ?? 'unknown'} (${input.userId})`);

  if (keys.state) {
    const checked = keys.checkedAt ? ` (checked ${time(keys.checkedAt)})` : '';
    lines.push(`Device keys on server: ${KEY_STATE_LABEL[keys.state]}${checked}`);
  } else {
    lines.push('Device keys on server: not checked yet');
  }
  if (keys.local) lines.push(`  This device: ed25519 ${fingerprint(keys.local.ed25519)}`);
  if (keys.state && keys.state !== DeviceKeysState.NotUploaded) {
    lines.push(`  Server: ed25519 ${fingerprint(keys.server?.ed25519)}`);
  }

  const changes = keys.history?.changes ?? [];
  if (keys.history && changes.length === 0) {
    lines.push(`Key changes on this device: none recorded since ${time(keys.history.since)}`);
  } else if (changes.length === 0) {
    lines.push('Key changes on this device: none recorded');
  } else {
    lines.push(`Key changes on this device: ${changes.length}`);
    changes.forEach((change) =>
      lines.push(`  ${time(change.at)}: ${fingerprint(change.from)} -> ${fingerprint(change.to)}`),
    );
  }

  if (repairs.focus === 0 && repairs.keydown === 0) {
    lines.push('Composer focus repairs: none');
  } else {
    const last =
      repairs.lastAt !== undefined
        ? `, last ${time(repairs.lastAt)}${repairs.lastTrigger ? ` (${repairs.lastTrigger})` : ''}`
        : '';
    lines.push(
      `Composer focus repairs: ${repairs.focus} on focus, ${repairs.keydown} on keypress${last}`,
    );
  }

  return lines;
};
