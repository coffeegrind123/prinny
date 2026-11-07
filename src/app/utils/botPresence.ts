/**
 * Bots whose sender is no longer joined drop out.
 *
 * Their advertisement (state event or timeline fallback) outlives them: a bot
 * that left, was kicked or banned still has its `app.prinny.bot.info` in room
 * state. Offering its commands sends messages nobody will answer. MSC4391 and
 * MSC4332 both require hiding commands from senders that are not joined.
 */
export const withoutDepartedBots = <T>(
  bots: Map<string, T>,
  membershipOf: (userId: string) => string | undefined,
): Map<string, T> => new Map([...bots].filter(([userId]) => membershipOf(userId) === 'join'));

/**
 * Member-event keys a user sets on themselves to say they are a bot: ours, and
 * MSC4015's (`bot`, unstable `dev.nordgedanken.msc4015`). MSC4015 was closed
 * without being rejected, and some bots set it.
 */
const BOT_MEMBER_KEYS = ['app.prinny.bot', 'bot', 'dev.nordgedanken.msc4015'] as const;

export const hasBotMemberFlag = (content: Record<string, unknown> | undefined): boolean =>
  BOT_MEMBER_KEYS.some((key) => content?.[key] === true);
