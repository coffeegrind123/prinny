import { describe, expect, it } from 'vitest';
import { hasStoredSecret, recoveryTileState } from './recoveryTile';

describe('hasStoredSecret', () => {
  it('is true for a secret encrypted with at least one key', () => {
    expect(hasStoredSecret({ encrypted: { key1: { iv: 'a', ciphertext: 'b', mac: 'c' } } })).toBe(
      true,
    );
  });

  it('is false for the empty object the SDK leaves when recovery is turned off', () => {
    // deleteSecretStorage stores null, which writes {} to the account data.
    expect(hasStoredSecret({})).toBe(false);
    expect(hasStoredSecret({ encrypted: {} })).toBe(false);
    expect(hasStoredSecret(undefined)).toBe(false);
    expect(hasStoredSecret({ encrypted: 'x' })).toBe(false);
  });
});

describe('recoveryTileState', () => {
  it('manages recovery that is on', () => {
    expect(recoveryTileState(true, 'present')).toBe('manage');
  });

  it('turns recovery back on around an identity that exists without it', () => {
    expect(recoveryTileState(false, 'present')).toBe('turnOn');
  });

  it('sets up from scratch only when the account has no identity', () => {
    expect(recoveryTileState(false, 'absent')).toBe('setup');
  });

  it('offers nothing that could replace an identity while that is unknown', () => {
    expect(recoveryTileState(false, 'unknown')).toBe('checking');
  });
});
