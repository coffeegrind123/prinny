export type PollShape = { answerIds: string[]; maxSelections: number };

export type PollTally = {
  /** Votes per answer id. */
  counts: Map<string, number>;
  /** Ballots that counted (not empty, not spoiled). */
  ballots: number;
};

/**
 * Count each sender's latest ballot by MSC3381's m.poll.response rules:
 * truncate to max_selections; if any remaining answer is not in the poll the
 * whole ballot is spoiled, as if no selection was made; an answer repeated in
 * one ballot counts once.
 *
 * The tally used to drop just the unknown answers and count the rest, and to
 * count repeats, so one sender with ["a","a","a"] gave "a" three votes.
 */
export const tallyBallots = (latestByUser: Map<string, string[]>, poll: PollShape): PollTally => {
  const validIds = new Set(poll.answerIds);
  const counts = new Map<string, number>();
  let ballots = 0;

  latestByUser.forEach((answers) => {
    const selected = answers.slice(0, poll.maxSelections);
    if (selected.length === 0) return;
    if (selected.some((id) => !validIds.has(id))) return;

    ballots += 1;
    new Set(selected).forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1));
  });

  return { counts, ballots };
};
