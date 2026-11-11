import { describe, expect, it } from 'vitest';
import { messageKeysFilename, recoveryKeyFilename } from './recoveryKeyFile';

describe('key file names', () => {
  it('name the recovery key and the message keys after the account', () => {
    expect(recoveryKeyFilename('@alice:example.org')).toBe(
      'prinny-recovery-key-alice-example.org.txt',
    );
    expect(messageKeysFilename('@alice:example.org')).toBe(
      'prinny-message-keys-alice-example.org.txt',
    );
  });

  it('keep Windows-reserved characters out', () => {
    expect(messageKeysFilename('@a:b/c:8448')).not.toMatch(/[:/\\@]/);
  });
});
