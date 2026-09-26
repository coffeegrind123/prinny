import { Membership } from '../../types/matrix/room';

/**
 * Element-style collapsing of membership events ("MELS" — Element's
 * `MemberEventListSummary`): a run of joins, leaves, invites, kicks, bans and
 * profile changes is drawn as one line — "alice joined and left 3 times, bob
 * and 2 others were invited" — with the events themselves behind a toggle.
 *
 * Everything here is pure and free of matrix-js-sdk so the wording can be
 * checked without a client. `RoomTimeline` decides what forms a run and
 * `MembershipEventGroup` turns `MatrixEvent`s into `MembershipSummaryEvent`s.
 */

/**
 * The fewest consecutive membership rows that collapse into a summary.
 *
 * Element's default threshold is 3; two is used here because two lines of
 * "joined" / "left" in a row are already the noise the summary exists to fold.
 */
export const MEMBERSHIP_GROUP_MIN_SIZE = 2;

/**
 * How many names a summary clause spells out before "and N others". One, as in
 * Element: a clause is about what happened, and a long list of names in every
 * clause makes the line wrap without saying more.
 */
export const SUMMARY_NAME_LIMIT = 1;

export enum MembershipTransition {
  Joined = 'joined',
  Left = 'left',
  JoinedAndLeft = 'joined_and_left',
  LeftAndJoined = 'left_and_joined',
  InviteReject = 'invite_reject',
  InviteWithdrawal = 'invite_withdrawal',
  Invited = 'invited',
  Banned = 'banned',
  Unbanned = 'unbanned',
  Kicked = 'kicked',
  Knocked = 'knocked',
  KnockRetracted = 'knock_retracted',
  KnockDenied = 'knock_denied',
  ChangedName = 'changed_name',
  ChangedAvatar = 'changed_avatar',
  NoChange = 'no_change',
  Removed = 'removed',
}

export type MembershipContent = {
  membership?: unknown;
  displayname?: unknown;
  avatar_url?: unknown;
};

export type MembershipSummaryEvent = {
  /** The member the event is about — its state key, not its sender. */
  userId: string;
  senderId: string;
  /** What to call this member in the summary. */
  displayName: string;
  redacted: boolean;
  content: MembershipContent;
  prevContent: MembershipContent;
};

export type SummaryToken = {
  kind: 'name' | 'text';
  value: string;
};

export type SummaryMember = {
  userId: string;
  displayName: string;
  avatarMxc?: string;
};

export type GroupedRow<T> = { kind: 'single'; row: T } | { kind: 'group'; rows: T[] };

/**
 * What one event did to its member, in the vocabulary of the summary.
 *
 * Follows Element's `getTransition`, plus the knock transitions it has no words
 * for. `undefined` is an event with no describable change (an unknown
 * membership), which the summary skips rather than calling it something.
 */
export const getMembershipTransition = (
  event: MembershipSummaryEvent,
): MembershipTransition | undefined => {
  if (event.redacted) {
    return MembershipTransition.Removed;
  }

  const membership = event.content.membership;
  const prevMembership = event.prevContent.membership;
  const bySelf = event.senderId === event.userId;

  switch (membership) {
    case Membership.Invite:
      return MembershipTransition.Invited;
    case Membership.Ban:
      return MembershipTransition.Banned;
    case Membership.Knock:
      return MembershipTransition.Knocked;
    case Membership.Join:
      if (prevMembership !== Membership.Join) {
        return MembershipTransition.Joined;
      }
      if (event.content.displayname !== event.prevContent.displayname) {
        return MembershipTransition.ChangedName;
      }
      if (event.content.avatar_url !== event.prevContent.avatar_url) {
        return MembershipTransition.ChangedAvatar;
      }
      return MembershipTransition.NoChange;
    case Membership.Leave:
      if (bySelf) {
        if (prevMembership === Membership.Invite) {
          return MembershipTransition.InviteReject;
        }
        if (prevMembership === Membership.Knock) {
          return MembershipTransition.KnockRetracted;
        }
        return MembershipTransition.Left;
      }
      if (prevMembership === Membership.Invite) {
        return MembershipTransition.InviteWithdrawal;
      }
      if (prevMembership === Membership.Ban) {
        return MembershipTransition.Unbanned;
      }
      if (prevMembership === Membership.Knock) {
        return MembershipTransition.KnockDenied;
      }
      return MembershipTransition.Kicked;
    default:
      return undefined;
  }
};

/**
 * Folds the two common round trips into single transitions, so "joined, left,
 * joined, left" reads as "joined and left" twice rather than four clauses.
 * Pairs are taken greedily left to right, as Element does.
 */
export const canonicaliseTransitions = (
  transitions: MembershipTransition[],
): MembershipTransition[] => {
  const pairs: Partial<Record<MembershipTransition, [MembershipTransition, MembershipTransition]>> =
    {
      [MembershipTransition.Joined]: [
        MembershipTransition.Left,
        MembershipTransition.JoinedAndLeft,
      ],
      [MembershipTransition.Left]: [
        MembershipTransition.Joined,
        MembershipTransition.LeftAndJoined,
      ],
    };

  const result: MembershipTransition[] = [];
  for (let i = 0; i < transitions.length; i += 1) {
    const transition = transitions[i];
    const pair = pairs[transition];
    if (pair && transitions[i + 1] === pair[0]) {
      result.push(pair[1]);
      i += 1;
    } else {
      result.push(transition);
    }
  }
  return result;
};

export type CoalescedTransition = {
  transition: MembershipTransition;
  repeats: number;
};

/** Collapses back-to-back repeats of one transition into a count. */
export const coalesceTransitions = (transitions: MembershipTransition[]): CoalescedTransition[] => {
  const result: CoalescedTransition[] = [];
  transitions.forEach((transition) => {
    const last = result[result.length - 1];
    if (last && last.transition === transition) {
      last.repeats += 1;
      return;
    }
    result.push({ transition, repeats: 1 });
  });
  return result;
};

/**
 * The verb phrase for one coalesced transition.
 *
 * `userCount` picks singular or plural agreement ("was invited" / "were
 * invited"); `repeats` above one appends the count. Worded after Element's
 * strings, except that a removal from the room keeps this client's own "kicked"
 * and a redacted membership event says what actually happened to it.
 */
export const describeTransition = (
  transition: MembershipTransition,
  userCount: number,
  repeats: number,
): string => {
  const plural = userCount > 1;
  const times = (phrase: string) => (repeats > 1 ? `${phrase} ${repeats} times` : phrase);

  switch (transition) {
    case MembershipTransition.Joined:
      return times('joined');
    case MembershipTransition.Left:
      return times('left');
    case MembershipTransition.JoinedAndLeft:
      return times('joined and left');
    case MembershipTransition.LeftAndJoined:
      return times('left and rejoined');
    case MembershipTransition.InviteReject:
      return times(plural ? 'rejected their invitations' : 'rejected their invitation');
    case MembershipTransition.InviteWithdrawal:
      return times(plural ? 'had their invitations withdrawn' : 'had their invitation withdrawn');
    case MembershipTransition.Invited:
      return times(plural ? 'were invited' : 'was invited');
    case MembershipTransition.Banned:
      return times(plural ? 'were banned' : 'was banned');
    case MembershipTransition.Unbanned:
      return times(plural ? 'were unbanned' : 'was unbanned');
    case MembershipTransition.Kicked:
      return times(plural ? 'were kicked' : 'was kicked');
    case MembershipTransition.Knocked:
      return times('requested to join');
    case MembershipTransition.KnockRetracted:
      return times(plural ? 'cancelled their requests to join' : 'cancelled their request to join');
    case MembershipTransition.KnockDenied:
      return times(
        plural ? 'had their requests to join rejected' : 'had their request to join rejected',
      );
    case MembershipTransition.ChangedName:
      return times('changed their name');
    case MembershipTransition.ChangedAvatar:
      return times('changed their avatar');
    case MembershipTransition.NoChange:
      return times('made no changes');
    case MembershipTransition.Removed:
      return repeats > 1
        ? `had ${repeats} membership changes deleted`
        : 'had a membership change deleted';
    default:
      return '';
  }
};

/** "a", "a and b", "a, b and c". */
export const formatList = (items: string[]): string => {
  if (items.length <= 1) {
    return items[0] ?? '';
  }
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
};

/**
 * The names of a clause as tokens, so the caller can set them in bold: "a",
 * "a and b", "a, b and c", or — past `limit` — "a and one other" / "a and 3
 * others".
 */
export const nameListTokens = (names: string[], limit: number): SummaryToken[] => {
  const name = (value: string): SummaryToken => ({ kind: 'name', value });
  const text = (value: string): SummaryToken => ({ kind: 'text', value });

  if (names.length === 0) {
    return [];
  }

  const others = names.length - Math.max(limit, 1);
  if (others > 0) {
    const tokens: SummaryToken[] = [];
    names.slice(0, Math.max(limit, 1)).forEach((value, index) => {
      if (index > 0) {
        tokens.push(text(', '));
      }
      tokens.push(name(value));
    });
    tokens.push(text(others === 1 ? ' and one other' : ` and ${others} others`));
    return tokens;
  }

  const tokens: SummaryToken[] = [];
  names.forEach((value, index) => {
    if (index > 0) {
      tokens.push(text(index === names.length - 1 ? ' and ' : ', '));
    }
    tokens.push(name(value));
  });
  return tokens;
};

/**
 * The summary line for a run of membership events, as tokens.
 *
 * Element's aggregation: each member's events become a sequence of transitions
 * (in event order); members whose sequences are identical share one clause;
 * clauses are ordered by the earliest event of any member in them. Within a
 * clause the sequence is canonicalised (join+leave pairs), repeats are counted,
 * and the phrases are joined "a, b and c". Clauses are joined with ", ".
 *
 *   alice: join, leave, join, leave  -> "alice joined and left 2 times"
 *   bob, carol, dan: invite          -> "bob and 2 others were invited"
 */
export const summarizeMembershipEvents = (
  events: MembershipSummaryEvent[],
  nameLimit: number = SUMMARY_NAME_LIMIT,
): SummaryToken[] => {
  const byUser = new Map<string, { displayName: string; transitions: MembershipTransition[] }>();
  events.forEach((event) => {
    let entry = byUser.get(event.userId);
    if (!entry) {
      entry = { displayName: event.displayName, transitions: [] };
      byUser.set(event.userId, entry);
    }
    const transition = getMembershipTransition(event);
    if (transition) {
      entry.transitions.push(transition);
    }
  });

  // Keyed by the joined sequence. Map iteration follows insertion, and users
  // were inserted in order of their first event, so the first user to produce a
  // sequence fixes that clause's position — Element's "lowest event index".
  const clauses = new Map<string, { names: string[]; transitions: MembershipTransition[] }>();
  byUser.forEach(({ displayName, transitions }) => {
    if (transitions.length === 0) {
      return;
    }
    const key = transitions.join(',');
    const clause = clauses.get(key);
    if (clause) {
      clause.names.push(displayName);
      return;
    }
    clauses.set(key, { names: [displayName], transitions });
  });

  const tokens: SummaryToken[] = [];
  clauses.forEach(({ names, transitions }) => {
    const phrases = coalesceTransitions(canonicaliseTransitions(transitions)).map(
      ({ transition, repeats }) => describeTransition(transition, names.length, repeats),
    );
    if (tokens.length > 0) {
      tokens.push({ kind: 'text', value: ', ' });
    }
    tokens.push(...nameListTokens(names, nameLimit));
    tokens.push({ kind: 'text', value: ` ${formatList(phrases)}` });
  });
  return tokens;
};

export const summaryTokensToText = (tokens: SummaryToken[]): string =>
  tokens.map((token) => token.value).join('');

const stringOrUndefined = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

/**
 * The avatar a member has after `event`, given the one they had before it.
 *
 * Join, invite and knock carry the member's profile, so their `avatar_url` —
 * or its absence — is the answer. Leave and ban usually carry no profile at
 * all, and a redacted event has lost it, so those keep what was known; the
 * event's `prev_content` is the next best source when nothing was.
 */
const avatarAfter = (event: MembershipSummaryEvent, before: string | undefined) => {
  if (event.redacted) {
    return before;
  }
  const own = stringOrUndefined(event.content.avatar_url);
  if (own) {
    return own;
  }
  const { membership } = event.content;
  if (
    membership === Membership.Join ||
    membership === Membership.Invite ||
    membership === Membership.Knock
  ) {
    return undefined;
  }
  return before ?? stringOrUndefined(event.prevContent.avatar_url);
};

/**
 * Everyone a run is about, in order of their first event, with the avatar they
 * had at their LAST event in it — the one the summary should show for someone
 * who changed it along the way.
 */
export const getSummaryMembers = (events: MembershipSummaryEvent[]): SummaryMember[] => {
  const members = new Map<string, SummaryMember>();
  events.forEach((event) => {
    const existing = members.get(event.userId);
    if (existing) {
      existing.avatarMxc = avatarAfter(event, existing.avatarMxc);
      return;
    }
    members.set(event.userId, {
      userId: event.userId,
      displayName: event.displayName,
      avatarMxc: avatarAfter(event, undefined),
    });
  });
  return Array.from(members.values());
};

/**
 * Splits rendered timeline rows into single rows and runs to collapse.
 *
 * A run is `minSize` or more consecutive groupable rows. `breaksRun` marks a row
 * that may not continue the run before it — one that carries a date or "new
 * messages" divider, which has to stay between the rows it separates. Such a
 * row can still START a run. Rows that render nothing must be dropped before
 * calling this: they are invisible, so they must not split a run either.
 */
export const groupMembershipRuns = <T>(
  rows: T[],
  isGroupable: (row: T) => boolean,
  breaksRun: (row: T) => boolean,
  minSize: number = MEMBERSHIP_GROUP_MIN_SIZE,
): GroupedRow<T>[] => {
  const result: GroupedRow<T>[] = [];
  let run: T[] = [];

  const flush = () => {
    if (run.length >= minSize) {
      result.push({ kind: 'group', rows: run });
    } else {
      run.forEach((row) => result.push({ kind: 'single', row }));
    }
    run = [];
  };

  rows.forEach((row) => {
    const groupable = isGroupable(row);
    if (groupable && run.length > 0 && !breaksRun(row)) {
      run.push(row);
      return;
    }
    flush();
    if (groupable) {
      run.push(row);
      return;
    }
    result.push({ kind: 'single', row });
  });
  flush();

  return result;
};
