import { DecryptionFailureCode } from 'matrix-js-sdk/lib/crypto-api';

// Every failure used to read "Unable to decrypt message", which made a missing
// backup, a withheld key and a key that never arrived look identical. The SDK
// classifies each failure; say which one it was.
const FAILURE_REASONS: Record<DecryptionFailureCode, string | undefined> = {
  [DecryptionFailureCode.MEGOLM_UNKNOWN_INBOUND_SESSION_ID]:
    "The sender's device never sent this device the key.",
  [DecryptionFailureCode.MEGOLM_KEY_WITHHELD]: 'The sender withheld the key from this device.',
  [DecryptionFailureCode.MEGOLM_KEY_WITHHELD_FOR_UNVERIFIED_DEVICE]:
    "The sender only shares keys with verified devices, and this device isn't verified.",
  [DecryptionFailureCode.OLM_UNKNOWN_MESSAGE_INDEX]:
    'This device only has the key for later messages in this conversation.',
  [DecryptionFailureCode.HISTORICAL_MESSAGE_NO_KEY_BACKUP]:
    "Sent before this device signed in, and there's no key backup to restore it from.",
  [DecryptionFailureCode.HISTORICAL_MESSAGE_BACKUP_UNCONFIGURED]:
    'Sent before this device signed in. Verify this device or enter your recovery key to restore it.',
  [DecryptionFailureCode.HISTORICAL_MESSAGE_WORKING_BACKUP]:
    "Sent before this device signed in, and the key backup doesn't have it.",
  [DecryptionFailureCode.HISTORICAL_MESSAGE_USER_NOT_JOINED]: "Sent while you weren't in the room.",
  [DecryptionFailureCode.SENDER_IDENTITY_PREVIOUSLY_VERIFIED]:
    "The sender's identity changed since you verified them.",
  [DecryptionFailureCode.UNSIGNED_SENDER_DEVICE]:
    "Sent from a device its owner hasn't verified, and you only accept messages from verified devices.",
  [DecryptionFailureCode.UNKNOWN_SENDER_DEVICE]:
    "Sent from a device this device doesn't know about.",
  [DecryptionFailureCode.UNKNOWN_ERROR]: undefined,
};

export const decryptionFailureReason = (
  code: DecryptionFailureCode | null | undefined,
): string | undefined => (code ? FAILURE_REASONS[code] : undefined);
