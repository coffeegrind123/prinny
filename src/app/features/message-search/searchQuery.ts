import { IEventWithRoomId } from 'matrix-js-sdk';

/**
 * Search operators (the `searchOperators` setting): free text plus
 * `operator:value` filters, as in Discord.
 *
 * The server only understands free text, a room list and a sender list. Its
 * `contains_url` means "content.url is set", i.e. an upload, not a link in the
 * text, so `has:link` is not sent. Everything else (`has:` kinds, dates,
 * `mentions:`, `pinned:`) is applied to results in the client, so it works
 * against any homeserver.
 */

export const HAS_KINDS = ['link', 'image', 'video', 'audio', 'file'] as const;
export type HasKind = (typeof HAS_KINDS)[number];

export const SEARCH_OPERATORS = [
  'from',
  'in',
  'mentions',
  'has',
  'before',
  'after',
  'during',
  'pinned',
] as const;
export type SearchOperator = (typeof SEARCH_OPERATORS)[number];

export type QueryToken =
  | { kind: 'text'; raw: string; start: number; end: number }
  | {
      kind: 'filter';
      operator: SearchOperator;
      value: string;
      raw: string;
      start: number;
      end: number;
    };

export type ParsedSearchQuery = {
  /** free text sent to the server */
  text: string;
  from: string[];
  in: string[];
  mentions: string[];
  has: HasKind[];
  /** exclusive upper bound, ms since epoch */
  before?: number;
  /** inclusive lower bound, ms since epoch */
  after?: number;
  pinned: boolean;
  /** filters whose value could not be understood, with the offending raw token */
  invalid: QueryToken[];
  tokens: QueryToken[];
};

const OPERATOR_SET = new Set<string>(SEARCH_OPERATORS);
const HAS_SET = new Set<string>(HAS_KINDS);

/**
 * Split on whitespace, keeping `"quoted phrases"` (and `op:"quoted value"`) whole.
 * An unterminated quote swallows the rest of the input, which is what a user
 * mid-way through typing a phrase expects.
 */
export const tokenizeQuery = (input: string): QueryToken[] => {
  const tokens: QueryToken[] = [];
  let i = 0;
  while (i < input.length) {
    if (/\s/.test(input[i])) {
      i += 1;
    } else {
      const start = i;
      let inQuote = false;
      while (i < input.length && (inQuote || !/\s/.test(input[i]))) {
        if (input[i] === '"') inQuote = !inQuote;
        i += 1;
      }
      const raw = input.slice(start, i);
      const colon = raw.indexOf(':');
      const operator = colon > 0 ? raw.slice(0, colon).toLowerCase() : undefined;
      if (operator && OPERATOR_SET.has(operator)) {
        tokens.push({
          kind: 'filter',
          operator: operator as SearchOperator,
          value: raw.slice(colon + 1).replace(/^"(.*?)"?$/, '$1'),
          raw,
          start,
          end: i,
        });
      } else {
        tokens.push({ kind: 'text', raw, start, end: i });
      }
    }
  }
  return tokens;
};

const startOfDay = (date: Date): number =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

const addDays = (ts: number, days: number): number => {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days).getTime();
};

/** `YYYY-MM-DD`, `today`, `yesterday`, or a Discord-ish `DD/MM/YYYY`-free ISO date. */
export const parseSearchDate = (value: string, now: number): number | undefined => {
  const v = value.trim().toLowerCase();
  if (v === 'today') return startOfDay(new Date(now));
  if (v === 'yesterday') return addDays(startOfDay(new Date(now)), -1);
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  if (!match) return undefined;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(y, m - 1, d);
  // reject rollovers such as 2026-02-31
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d)
    return undefined;
  return date.getTime();
};

export const parseSearchQuery = (input: string, now: number = Date.now()): ParsedSearchQuery => {
  const tokens = tokenizeQuery(input);
  const query: ParsedSearchQuery = {
    text: '',
    from: [],
    in: [],
    mentions: [],
    has: [],
    pinned: false,
    invalid: [],
    tokens,
  };
  const text: string[] = [];

  tokens.forEach((token) => {
    if (token.kind === 'text') {
      text.push(token.raw);
      return;
    }
    const { operator, value } = token;
    // `from:` while the value is still being typed is neither text nor a filter
    if (!value) return;

    switch (operator) {
      case 'from':
      case 'in':
      case 'mentions':
        query[operator].push(value);
        break;
      case 'has': {
        const kind = value.toLowerCase();
        if (HAS_SET.has(kind)) {
          if (!query.has.includes(kind as HasKind)) query.has.push(kind as HasKind);
        } else query.invalid.push(token);
        break;
      }
      case 'pinned':
        if (value.toLowerCase() === 'true') query.pinned = true;
        else query.invalid.push(token);
        break;
      case 'before':
      case 'after':
      case 'during': {
        const day = parseSearchDate(value, now);
        if (day === undefined) {
          query.invalid.push(token);
          break;
        }
        // `after:D` excludes day D, as on Discord
        const lower = operator === 'after' ? addDays(day, 1) : day;
        const upper = operator === 'during' ? addDays(day, 1) : day;
        if (operator !== 'before') {
          query.after = query.after === undefined ? lower : Math.max(query.after, lower);
        }
        if (operator !== 'after') {
          query.before = query.before === undefined ? upper : Math.min(query.before, upper);
        }
        break;
      }
      default:
        break;
    }
  });

  query.text = text.join(' ');
  return query;
};

/**
 * Remove one token from the raw query string. Only the gap it leaves is
 * tidied; whitespace inside quoted phrases elsewhere stays as typed.
 */
export const removeQueryToken = (input: string, token: QueryToken): string => {
  const before = input.slice(0, token.start).trimEnd();
  const after = input.slice(token.end).trimStart();
  return before && after ? `${before} ${after}` : `${before}${after}`;
};

export type SearchLookup = {
  /** userId -> display name, for every candidate sender */
  users: { userId: string; name: string }[];
  /** roomId -> name, for every candidate room */
  rooms: { roomId: string; name: string }[];
};

// `@user:server` and `#room:server` match with or without their sigil
const normalize = (s: string): string => s.normalize('NFKC').toLowerCase().replace(/^[@#]/, '');

const localpart = (userId: string): string => userId.replace(/^@/, '').split(':')[0];

/**
 * Resolve a typed name to ids. Exact (id, localpart, display name) wins; failing
 * that a unique prefix does. Several exact matches all count, since two members
 * called "alex" is a legitimate thing to search for.
 */
export const resolveNames = <T>(
  names: string[],
  candidates: T[],
  getKeys: (c: T) => string[],
): { matched: T[]; unresolved: string[] } => {
  const matched = new Set<T>();
  const unresolved: string[] = [];
  names.forEach((name) => {
    const needle = normalize(name);
    const exact = candidates.filter((c) => getKeys(c).some((k) => normalize(k) === needle));
    if (exact.length > 0) {
      exact.forEach((c) => matched.add(c));
      return;
    }
    const prefix = candidates.filter((c) =>
      getKeys(c).some((k) => normalize(k).startsWith(needle)),
    );
    if (prefix.length > 0) prefix.forEach((c) => matched.add(c));
    else unresolved.push(name);
  });
  return { matched: Array.from(matched), unresolved };
};

/** Whether anything besides free text narrows the search. */
export const hasQueryFilters = (query: ParsedSearchQuery): boolean =>
  query.from.length > 0 ||
  query.in.length > 0 ||
  query.mentions.length > 0 ||
  query.has.length > 0 ||
  query.before !== undefined ||
  query.after !== undefined ||
  query.pinned;

export type ResolvedSearch = {
  text: string;
  rooms?: string[];
  senders?: string[];
  mentions?: string[];
  has: HasKind[];
  before?: number;
  after?: number;
  pinned: boolean;
  /** raw values that matched no member / room */
  unresolved: { operator: SearchOperator; value: string }[];
  invalid: QueryToken[];
  /** true when results must be filtered in the client after the server answers */
  needsClientFilter: boolean;
  /** anything besides free text narrows the search */
  hasFilters: boolean;
};

export const resolveSearchQuery = (
  query: ParsedSearchQuery,
  lookup: SearchLookup,
  /** Rooms searched without an in:; undefined searches every room. */
  defaultRooms: string[] | undefined,
): ResolvedSearch => {
  const unresolved: ResolvedSearch['unresolved'] = [];

  const users = resolveNames(query.from, lookup.users, (u) => [
    u.userId,
    localpart(u.userId),
    u.name,
  ]);
  users.unresolved.forEach((value) => unresolved.push({ operator: 'from', value }));

  const mentions = resolveNames(query.mentions, lookup.users, (u) => [
    u.userId,
    localpart(u.userId),
    u.name,
  ]);
  mentions.unresolved.forEach((value) => unresolved.push({ operator: 'mentions', value }));

  const rooms = resolveNames(query.in, lookup.rooms, (r) => [r.roomId, r.name]);
  rooms.unresolved.forEach((value) => unresolved.push({ operator: 'in', value }));

  const needsClientFilter =
    query.has.length > 0 ||
    query.before !== undefined ||
    query.after !== undefined ||
    query.mentions.length > 0 ||
    query.pinned;

  return {
    text: query.text,
    rooms: query.in.length > 0 ? rooms.matched.map((r) => r.roomId) : defaultRooms,
    senders: query.from.length > 0 ? users.matched.map((u) => u.userId) : undefined,
    mentions: query.mentions.length > 0 ? mentions.matched.map((u) => u.userId) : undefined,
    has: query.has,
    before: query.before,
    after: query.after,
    pinned: query.pinned,
    unresolved,
    invalid: query.invalid,
    needsClientFilter,
    hasFilters: hasQueryFilters(query),
  };
};

const URL_REGEX = /https?:\/\/\S+/i;

const hasKind = (event: IEventWithRoomId, kind: HasKind): boolean => {
  const content = (event.content['m.new_content'] ?? event.content) as Record<string, unknown>;
  const msgtype = content.msgtype as string | undefined;
  switch (kind) {
    case 'image':
      return msgtype === 'm.image';
    case 'video':
      return msgtype === 'm.video';
    case 'audio':
      return msgtype === 'm.audio';
    case 'file':
      return msgtype === 'm.file';
    case 'link':
      return (
        typeof content.body === 'string' &&
        (URL_REGEX.test(content.body) ||
          (typeof content.formatted_body === 'string' &&
            /<a\s[^>]*href=/i.test(content.formatted_body)))
      );
    default:
      return false;
  }
};

const mentionsUser = (event: IEventWithRoomId, userId: string): boolean => {
  const content = (event.content['m.new_content'] ?? event.content) as Record<string, unknown>;
  const userIds = (content['m.mentions'] as { user_ids?: unknown } | undefined)?.user_ids;
  if (Array.isArray(userIds) && userIds.includes(userId)) return true;
  // pre-m.mentions clients put a matrix.to pill in the formatted body
  const formatted = content.formatted_body;
  return typeof formatted === 'string' && formatted.includes(`matrix.to/#/${userId}`);
};

export type PinnedLookup = (roomId: string) => ReadonlySet<string>;

/** Client-side half of the query. Returns a predicate over one result event. */
export const makeResultFilter = (
  search: ResolvedSearch,
  getPinned: PinnedLookup,
): ((event: IEventWithRoomId) => boolean) => {
  const { has, before, after, mentions, pinned } = search;
  return (event) => {
    if (before !== undefined && event.origin_server_ts >= before) return false;
    if (after !== undefined && event.origin_server_ts < after) return false;
    if (has.some((kind) => !hasKind(event, kind))) return false;
    if (mentions && !mentions.some((userId) => mentionsUser(event, userId))) return false;
    if (pinned) {
      const relation = event.content['m.relates_to'];
      // an edit is pinned under the id of the event it replaces
      const id = relation?.rel_type === 'm.replace' ? relation.event_id : event.event_id;
      if (!id || !getPinned(event.room_id).has(id)) return false;
    }
    return true;
  };
};
