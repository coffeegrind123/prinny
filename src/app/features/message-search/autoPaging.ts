/**
 * How many of the most recent pages, among those fetched after `since`,
 * added nothing to the visible results.
 *
 * Search pages on its own while the end of the list is in view, and client
 * filters (has:, dates, mentions:, pinned:) can empty whole pages. Without a
 * limit, a filtered search whose last row stays in view would page through
 * the room's entire history. `since` is the page count when the user last
 * asked to search further, so the limit applies afresh from there.
 */
export const emptyPageStreak = (visiblePerPage: number[], since: number): number => {
  let streak = 0;
  for (let i = visiblePerPage.length - 1; i >= since; i -= 1) {
    if (visiblePerPage[i] > 0) break;
    streak += 1;
  }
  return streak;
};
