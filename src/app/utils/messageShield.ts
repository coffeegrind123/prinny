import {
  EventEncryptionInfo,
  EventShieldColour,
  EventShieldReason,
} from 'matrix-js-sdk/lib/crypto-api';

/** A note to show next to a message whose sender could not be fully checked. */
export type MessageShield = {
  colour: 'red' | 'grey';
  text: string;
};

const REASON_TEXT: Record<EventShieldReason, string> = {
  [EventShieldReason.UNKNOWN]: "The sender of this message couldn't be checked.",
  [EventShieldReason.UNVERIFIED_IDENTITY]: "Sent by someone you haven't verified.",
  [EventShieldReason.UNSIGNED_DEVICE]:
    "Sent from a session its owner hasn't verified, so it can't be confirmed that they sent it. Ask them to verify their sessions.",
  [EventShieldReason.UNKNOWN_DEVICE]:
    "Sent from a session that is unknown or has since signed out, so the sender can't be confirmed.",
  [EventShieldReason.AUTHENTICITY_NOT_GUARANTEED]:
    "The key for this message came from your key backup or another of your sessions, not from the sender, so its authenticity can't be guaranteed on this device.",
  [EventShieldReason.MISMATCHED_SENDER_KEY]:
    "The key this message was encrypted with doesn't match the sender's session.",
  [EventShieldReason.SENT_IN_CLEAR]: 'This message was sent without encryption.',
  [EventShieldReason.VERIFICATION_VIOLATION]:
    'You verified this person before, but their identity has changed since. Verify them again to trust their messages.',
  [EventShieldReason.MISMATCHED_SENDER]:
    "The sender shown doesn't match the account that encrypted this message, so don't rely on who it says it's from.",
};

/**
 * What the SDK says about a decrypted message's sender, as a note. The SDK decides what is
 * worth a shield (an ordinary unverified contact is not), so this only words it.
 */
export const messageShield = (
  info: EventEncryptionInfo | null | undefined,
): MessageShield | null => {
  if (!info || info.shieldColour === EventShieldColour.NONE) return null;

  const text = REASON_TEXT[info.shieldReason ?? EventShieldReason.UNKNOWN];
  return { colour: info.shieldColour === EventShieldColour.RED ? 'red' : 'grey', text };
};
