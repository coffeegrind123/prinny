import { describe, expect, it } from 'vitest';
import {
  DeviceKeysState,
  MAX_DEVICE_KEY_CHANGES,
  compareDeviceKeys,
  parseDeviceKeysHistory,
  recordDeviceKeys,
} from './deviceKeysCheck';

const LOCAL = {
  ed25519: 'R9OIoXJxv8WXq5JDKCVbLPoP981x1ySluMKcR7qJIuI',
  curve25519: 'o0lrhR/EwPSHtdihn8rAGUNH4GBW57TXjHPKGFfcM3I',
};

describe('compareDeviceKeys', () => {
  it('matches when the server holds exactly our keys', () => {
    expect(
      compareDeviceKeys('DEV', LOCAL, {
        'ed25519:DEV': LOCAL.ed25519,
        'curve25519:DEV': LOCAL.curve25519,
      }),
    ).toBe(DeviceKeysState.Match);
  });

  it('is a mismatch when the server kept the keys of an earlier crypto store', () => {
    // Measured on Conduit after this device's crypto store was lost: the new account's upload
    // was ignored and the server kept serving the old keys.
    expect(
      compareDeviceKeys('DEV', LOCAL, {
        'ed25519:DEV': '6Kof3kify2b2ki4+8uPlx77BANmBijwDUL0MqymIX1E',
        'curve25519:DEV': 'SW1kGrC+Fw8XOzFqcI6I5QT276SjVCJAGZsEigzj2R0',
      }),
    ).toBe(DeviceKeysState.Mismatch);
    expect(
      compareDeviceKeys('DEV', LOCAL, {
        'ed25519:DEV': LOCAL.ed25519,
        'curve25519:DEV': 'SW1kGrC+Fw8XOzFqcI6I5QT276SjVCJAGZsEigzj2R0',
      }),
    ).toBe(DeviceKeysState.Mismatch);
  });

  it('is not uploaded yet when the server has no keys for the device', () => {
    expect(compareDeviceKeys('DEV', LOCAL, undefined)).toBe(DeviceKeysState.NotUploaded);
    expect(compareDeviceKeys('DEV', LOCAL, {})).toBe(DeviceKeysState.NotUploaded);
  });
});

describe('recordDeviceKeys', () => {
  const OTHER = {
    ed25519: '6Kof3kify2b2ki4+8uPlx77BANmBijwDUL0MqymIX1E',
    curve25519: 'SW1kGrC+Fw8XOzFqcI6I5QT276SjVCJAGZsEigzj2R0',
  };

  it('starts a history the first time a device is seen', () => {
    expect(recordDeviceKeys(undefined, LOCAL, 1000)).toEqual({
      ...LOCAL,
      since: 1000,
      changes: [],
    });
  });

  it('keeps the history when the keys are the same', () => {
    const first = recordDeviceKeys(undefined, LOCAL, 1000);
    expect(recordDeviceKeys(first, LOCAL, 2000)).toBe(first);
  });

  it('records a change when the same device starts with other keys', () => {
    // A lost crypto store under a surviving login: the SDK makes a new account for the old
    // device ID, so the keys change while the device ID does not.
    const first = recordDeviceKeys(undefined, LOCAL, 1000);
    expect(recordDeviceKeys(first, OTHER, 2000)).toEqual({
      ...OTHER,
      since: 2000,
      changes: [{ at: 2000, from: LOCAL.ed25519, to: OTHER.ed25519 }],
    });
  });

  it('keeps only the most recent changes', () => {
    let history = recordDeviceKeys(undefined, LOCAL, 0);
    for (let i = 1; i <= 25; i += 1) {
      history = recordDeviceKeys(history, i % 2 ? OTHER : LOCAL, i);
    }
    expect(history.changes).toHaveLength(MAX_DEVICE_KEY_CHANGES);
    expect(history.changes[history.changes.length - 1].at).toBe(25);
  });
});

describe('parseDeviceKeysHistory', () => {
  it('reads back what was stored', () => {
    const history = recordDeviceKeys(undefined, LOCAL, 1000);
    expect(parseDeviceKeysHistory(JSON.stringify(history))).toEqual(history);
  });

  it('treats anything else as no history', () => {
    expect(parseDeviceKeysHistory(null)).toBeUndefined();
    expect(parseDeviceKeysHistory('not json')).toBeUndefined();
    expect(parseDeviceKeysHistory('{"ed25519":1}')).toBeUndefined();
    expect(
      parseDeviceKeysHistory(JSON.stringify({ ...LOCAL, since: 1, changes: [{ at: 'x' }] })),
    ).toBeUndefined();
  });
});
