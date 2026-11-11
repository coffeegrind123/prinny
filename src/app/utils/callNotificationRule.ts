import { MatrixClient, Method } from 'matrix-js-sdk';
import { AccountDataEvent } from '../../types/matrix/accountData';

export const CALL_NOTIFICATION_RULE_ID = 'app.prinny.call_notification';
/** `org.matrix.msc4075.rtc.notification` (current) and `org.matrix.msc4075.call.notify` (older). */
export const CALL_NOTIFICATION_TYPE_PATTERN = 'org.matrix.msc4075.*.notif*';

/**
 * Starting a call posts a ring notification carrying `m.mentions.room`, which the default
 * `.m.rule.is_room_mention` turns into a highlight for every member: a red @ badge on the room for
 * everyone, as if they had been mentioned. Measured on Synapse 1.164 with Element Call's own event.
 *
 * A user override rule for the notification events (notify, with sound, without highlight) wins
 * over that server-default rule, so the call still notifies and rings, and nobody is shown a
 * mention. It is server-side, so the counts are right in every client and in mobile pushes, for
 * events whether or not this client has loaded them.
 *
 * It goes below the user's existing override rules: a muted room (an override rule per room) still
 * suppresses it, and mutes made later are added above it anyway. Installed once per account and
 * recorded in account data, so a reader who deletes it keeps it deleted.
 */
const callNotificationRule = {
  conditions: [{ kind: 'event_match', key: 'type', pattern: CALL_NOTIFICATION_TYPE_PATTERN }],
  actions: ['notify', { set_tweak: 'sound', value: 'default' }],
};

export const ensureCallNotificationRule = async (mx: MatrixClient): Promise<void> => {
  const overrides = mx.pushRules?.global?.override;
  if (!overrides) return;

  const recorded = mx
    .getAccountData(AccountDataEvent.PrinnyCallNotificationRule)
    ?.getContent<{ installed?: boolean }>();
  if (recorded?.installed) return;

  if (!overrides.some((rule) => rule.rule_id === CALL_NOTIFICATION_RULE_ID)) {
    const userRules = overrides.filter((rule) => !rule.rule_id.startsWith('.'));
    const lastUserRule = userRules[userRules.length - 1]?.rule_id;
    await mx.http.authedRequest(
      Method.Put,
      `/pushrules/global/override/${encodeURIComponent(CALL_NOTIFICATION_RULE_ID)}`,
      lastUserRule ? { after: lastUserRule } : undefined,
      callNotificationRule,
    );
  }
  await mx.setAccountData(AccountDataEvent.PrinnyCallNotificationRule, { installed: true });
};
