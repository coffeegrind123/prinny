import { describe, expect, it } from 'vitest';
import { DeviceKeysState, compareDeviceKeys } from './deviceKeysCheck';

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
