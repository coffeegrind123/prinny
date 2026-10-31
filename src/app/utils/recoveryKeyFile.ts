import { getMxIdLocalPart, getMxIdServer } from './matrix';

const UNSAFE_FILENAME_CHARS = /[^A-Za-z0-9._-]+/g;
const MAX_ACCOUNT_LENGTH = 80;

const fileSafe = (text: string): string =>
  text.replace(UNSAFE_FILENAME_CHARS, '-').replace(/^[-.]+|[-.]+$/g, '');

/**
 * Name for the downloaded recovery key, so keys for different accounts do not all become
 * `recovery-key (2).txt`. It stays plain text on purpose: the file is opened when everything
 * else is lost, so any device and password manager must be able to read it. The Matrix ID's
 * `@` and `:` are replaced because `:` is not allowed in Windows filenames.
 */
export const recoveryKeyFilename = (userId: string): string => {
  const localPart = getMxIdLocalPart(userId);
  const server = getMxIdServer(userId);
  const account = fileSafe(
    fileSafe(localPart && server ? `${localPart}-${server}` : userId).slice(0, MAX_ACCOUNT_LENGTH),
  );

  return account ? `prinny-recovery-key-${account}.txt` : 'prinny-recovery-key.txt';
};
