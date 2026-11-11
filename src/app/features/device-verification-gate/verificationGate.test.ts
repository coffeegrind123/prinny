import { describe, expect, it } from 'vitest';
import { DeviceKeysState } from '../../../client/deviceKeysCheck';
import { showKeysLost } from './verificationGate';

describe('showKeysLost', () => {
  it('replaces verification when the server holds other keys for this device', () => {
    // Emoji verification then fails at the MAC step after both sides press "They match", and a
    // recovery key cannot sign keys the server does not have.
    expect(showKeysLost('verify', false, DeviceKeysState.Mismatch)).toBe(true);
  });

  it('stays out of the way otherwise', () => {
    expect(showKeysLost('verify', false, DeviceKeysState.Match)).toBe(false);
    expect(showKeysLost('verify', false, DeviceKeysState.NotUploaded)).toBe(false);
    expect(showKeysLost('verify', false, undefined)).toBe(false);
    expect(showKeysLost('setup', false, DeviceKeysState.Mismatch)).toBe(false);
    expect(showKeysLost('verify', true, DeviceKeysState.Mismatch)).toBe(false);
  });
});
