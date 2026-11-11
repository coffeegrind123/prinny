import { describe, expect, it } from 'vitest';
import { DeviceKeysState } from '../../../../client/deviceKeysCheck';
import { DiagnosticsInput, formatDiagnostics } from './diagnostics';

const BASE: DiagnosticsInput = {
  version: '4.11.272',
  commit: 'abc1234',
  platform: 'Android app',
  userAgent: 'UA',
  homeserver: 'https://example.org',
  serverName: 'Conduit',
  serverVersion: '0.10.0',
  userId: '@a:example.org',
  deviceId: 'DEV',
  keys: {},
  repairs: { focus: 0, keydown: 0 },
};

const at = Date.UTC(2026, 10, 11, 9, 5);

describe('formatDiagnostics', () => {
  it('names the app, server and device', () => {
    const text = formatDiagnostics(BASE).join('\n');
    expect(text).toContain('App: v4.11.272 (abc1234), Android app');
    expect(text).toContain('Homeserver: https://example.org (Conduit 0.10.0)');
    expect(text).toContain('Device: DEV (@a:example.org)');
    expect(text).toContain('Device keys on server: not checked yet');
    expect(text).toContain('Key changes on this device: none recorded');
    expect(text).toContain('Composer focus repairs: none');
  });

  it('shows both fingerprints when the server holds other keys', () => {
    const text = formatDiagnostics({
      ...BASE,
      serverName: undefined,
      keys: {
        state: DeviceKeysState.Mismatch,
        checkedAt: at,
        local: { ed25519: 'LOCALKEY1234567890', curve25519: 'c' },
        server: { ed25519: 'SERVERKEY123456789', curve25519: 'd' },
      },
    }).join('\n');
    expect(text).toContain('Homeserver: https://example.org (software unknown)');
    expect(text).toContain('Device keys on server: MISMATCH (checked 2026-11-11 09:05 UTC)');
    expect(text).toContain('This device: ed25519 LOCALKEY1234');
    expect(text).toContain('Server: ed25519 SERVERKEY123');
  });

  it('lists recorded key changes and focus repairs', () => {
    const text = formatDiagnostics({
      ...BASE,
      keys: {
        state: DeviceKeysState.Match,
        checkedAt: at,
        history: {
          ed25519: 'NEWKEY',
          curve25519: 'c',
          since: at,
          changes: [{ at, from: 'OLDKEY', to: 'NEWKEY' }],
        },
      },
      repairs: { focus: 2, keydown: 1, lastAt: at, lastTrigger: 'keydown' },
    }).join('\n');
    expect(text).toContain('Device keys on server: match');
    expect(text).toContain('Key changes on this device: 1');
    expect(text).toContain('2026-11-11 09:05 UTC: OLDKEY -> NEWKEY');
    expect(text).toContain(
      'Composer focus repairs: 2 on focus, 1 on keypress, last 2026-11-11 09:05 UTC (keydown)',
    );
  });
});
