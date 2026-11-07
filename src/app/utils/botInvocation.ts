/**
 * MSC4391 bot commands on the client side: reading the descriptions bots
 * publish, and turning what the user typed into a structured invocation.
 *
 * The text stays what it always was (`/cmd@bot args`), because every bot and
 * every other client understands that. The structured block rides alongside
 * it for bots that read it, which then need not parse our text at all.
 *
 * Pure: no React, no client. The hooks and the composer call into this.
 */

import { MatrixEvent } from 'matrix-js-sdk';
import {
  Msc4391,
  sanitizeCommandDescription,
  type Msc4391CommandDescription,
  type Msc4391Parameter,
  type Msc4391PrimitiveType,
  type Msc4391RoomReference,
  type Msc4391Schema,
} from '../../types/matrix/bot';
import { parseMatrixTarget } from '../plugins/matrix-uri';

/** MSC4391 command descriptions per bot, keyed by the sender's MXID. */
export type BotDescriptions = Map<string, Msc4391CommandDescription[]>;

/**
 * Group description state events by their sender.
 *
 * Commands are scoped by sender (the proposal's invariant), so a description
 * is attributed to whoever sent it, never to the user its state key might
 * have been derived from. The key itself is not re-hashed: it only
 * deduplicates, and checking it would not change whose command this is.
 * Withdrawn (`{}`) and invalid descriptions drop out here.
 */
export const collectDescriptions = (events: MatrixEvent[]): BotDescriptions => {
  const bots: BotDescriptions = new Map();
  events.forEach((event) => {
    const sender = event.getSender();
    if (!sender) return;
    const description = sanitizeCommandDescription(event.getContent());
    if (!description) return;
    const list = bots.get(sender) ?? [];
    if (list.some((existing) => existing.command === description.command)) return;
    list.push(description);
    bots.set(sender, list);
  });
  // State has no order; a stable one keeps the menu from reshuffling.
  bots.forEach((list) => list.sort((a, b) => a.command.localeCompare(b.command)));
  return bots;
};

/** The plain-text description of a command, for the menu. */
export const descriptionText = (description: Msc4391CommandDescription): string =>
  description.description?.['m.text'][0]?.body ?? '';

/** A usage hint from the parameters: `<required> [optional] <many...>`. */
export const argsHintOf = (description: Msc4391CommandDescription): string | undefined => {
  const params = description.parameters ?? [];
  if (params.length === 0) return undefined;
  return params
    .map((param) => {
      const name = param.schema.schema_type === 'array' ? `${param.key}...` : param.key;
      return param.optional ? `[${name}]` : `<${name}>`;
    })
    .join(' ');
};

// ── Text to arguments ────────────────────────────────────────────────────────

type Token = { value: string; start: number };

/** Split on whitespace, honouring "double quotes" with backslash escapes. */
const tokenize = (text: string): Token[] => {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i += 1;
    if (i >= text.length) break;
    const start = i;
    let value = '';
    if (text[i] === '"') {
      i += 1;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < text.length) i += 1;
        value += text[i];
        i += 1;
      }
      i += 1;
    } else {
      while (i < text.length && !/\s/.test(text[i])) {
        value += text[i];
        i += 1;
      }
    }
    tokens.push({ value, start });
  }
  return tokens;
};

const TRUE_WORDS = new Set(['true', 'yes', 'on', '1']);
const FALSE_WORDS = new Set(['false', 'no', 'off', '0']);

const parseBoolean = (raw: string): boolean | undefined => {
  const word = raw.toLowerCase();
  if (TRUE_WORDS.has(word)) return true;
  if (FALSE_WORDS.has(word)) return false;
  return undefined;
};

const parseInteger = (raw: string): number | undefined => {
  if (!/^-?\d+$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : undefined;
};

const USER_ID = /^@[^\s:]+:[^\s]+$/;
const ROOM_ID = /^![^\s]+$/;
const ROOM_ALIAS = /^#[^\s:]+:[^\s]+$/;
const SERVER_NAME = /^(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/;

/**
 * A room reference from a bare room ID, a `matrix:` URI or a matrix.to link.
 * The proposal's tip: clients may accept wider input, provided they send the
 * expected value.
 */
const parseRoomReference = (
  raw: string,
  type: 'room_id' | 'event_id',
): Msc4391RoomReference | undefined => {
  if (type === 'room_id' && ROOM_ID.test(raw)) return { type, id: raw };
  const target = parseMatrixTarget(raw);
  if (target?.kind !== 'room' || !target.roomIdOrAlias.startsWith('!')) return undefined;
  const via = target.viaServers.length > 0 ? { via: target.viaServers } : {};
  if (type === 'room_id') {
    return target.eventId ? undefined : { type, id: target.roomIdOrAlias, ...via };
  }
  if (!target.eventId) return undefined;
  return { type, id: target.roomIdOrAlias, event_id: target.eventId, ...via };
};

const parsePrimitive = (type: Msc4391PrimitiveType, raw: string): unknown => {
  switch (type) {
    case 'string':
      return raw;
    case 'integer':
      return parseInteger(raw);
    case 'boolean':
      return parseBoolean(raw);
    case 'user_id': {
      if (USER_ID.test(raw)) return raw;
      const target = parseMatrixTarget(raw);
      return target?.kind === 'user' ? target.userId : undefined;
    }
    case 'server_name':
      return SERVER_NAME.test(raw) ? raw : undefined;
    case 'room_alias': {
      if (ROOM_ALIAS.test(raw)) return raw;
      const target = parseMatrixTarget(raw);
      return target?.kind === 'room' && target.roomIdOrAlias.startsWith('#') && !target.eventId
        ? target.roomIdOrAlias
        : undefined;
    }
    case 'room_id':
    case 'event_id':
      return parseRoomReference(raw, type);
    default:
      return undefined;
  }
};

/** One value against a non-array schema, or `undefined` if it does not fit. */
const parseValue = (schema: Msc4391Schema, raw: string): unknown => {
  switch (schema.schema_type) {
    case 'primitive':
      return parsePrimitive(schema.type, raw);
    case 'literal': {
      const { value } = schema;
      if (typeof value === 'string')
        return raw.toLowerCase() === value.toLowerCase() ? value : undefined;
      if (typeof value === 'number') return parseInteger(raw) === value ? value : undefined;
      return parseBoolean(raw) === value ? value : undefined;
    }
    case 'union':
      for (const variant of schema.variants) {
        const parsed = parseValue(variant, raw);
        if (parsed !== undefined) return parsed;
      }
      return undefined;
    default:
      return undefined;
  }
};

const parseItems = (param: Msc4391Parameter, raws: string[]): unknown[] | undefined => {
  if (param.schema.schema_type !== 'array') return undefined;
  const { items } = param.schema;
  const values = raws.map((raw) => parseValue(items, raw));
  return values.some((v) => v === undefined) ? undefined : values;
};

/**
 * What the user typed after the command, as the description's arguments, or
 * `null` when it does not fit the schema.
 *
 * Parameters are filled in order, one word (or "quoted phrase") each. The tail
 * parameter takes the rest of the line verbatim. An array takes every word
 * left when it is the last parameter, or one comma-separated word otherwise.
 * An optional parameter that cannot take the next word is skipped.
 *
 * `null` means "send the text alone": a bot reading the block would get a
 * wrong or partial command, while the text is still what the user meant.
 */
export const textToArguments = (
  description: Msc4391CommandDescription,
  text: string,
): Record<string, unknown> | null => {
  const params = description.parameters ?? [];
  const tokens = tokenize(text);
  const tail = description[Msc4391.TailParameter];
  const args: Record<string, unknown> = {};
  let next = 0;

  for (let p = 0; p < params.length; p += 1) {
    const param = params[p];
    const isLast = p === params.length - 1;

    if (next >= tokens.length) {
      if (!param.optional) return null;
      continue;
    }

    if (param.key === tail) {
      const rest = text.slice(tokens[next].start).trim();
      const value =
        param.schema.schema_type === 'array'
          ? parseItems(
              param,
              tokens.slice(next).map((t) => t.value),
            )
          : parseValue(param.schema, rest);
      if (value === undefined) return null;
      args[param.key] = value;
      next = tokens.length;
      continue;
    }

    if (param.schema.schema_type === 'array') {
      const raws = isLast
        ? tokens.slice(next).map((t) => t.value)
        : tokens[next].value.split(',').filter((s) => s !== '');
      const values = parseItems(param, raws);
      if (values === undefined) {
        if (param.optional) continue;
        return null;
      }
      args[param.key] = values;
      next = isLast ? tokens.length : next + 1;
      continue;
    }

    const value = parseValue(param.schema, tokens[next].value);
    if (value === undefined) {
      if (param.optional) continue;
      return null;
    }
    args[param.key] = value;
    next += 1;
  }

  return next < tokens.length ? null : args;
};

// ── Matching and sending ─────────────────────────────────────────────────────

/** What the composer needs to know about one offered bot command. */
export type InvocableCommand = {
  /** The command as published, possibly with spaces ("rooms add"). */
  name: string;
  botUserId: string;
  /** What the menu inserts: `name`, or the addressed form when ambiguous. */
  insertName: string;
  /** Always addressed: `cmd@localpart`, then any further words. */
  addressedName: string;
  msc4391?: Msc4391CommandDescription;
};

export type CommandMatch<T extends InvocableCommand> = { entry: T; argsText: string };

const startsWithWord = (text: string, word: string): boolean =>
  text === word || (text.startsWith(word) && /\s/.test(text[word.length]));

/**
 * The bot command a message starting with `/` invokes, and the text after it.
 *
 * Matches what the menu inserted, the always-addressed form, or the bare name
 * when only one bot offers it. The longest match wins, so `/rooms add x` picks
 * `rooms add` over `rooms`.
 */
export const findBotCommand = <T extends InvocableCommand>(
  entries: T[],
  text: string,
): CommandMatch<T> | undefined => {
  if (!text.startsWith('/')) return undefined;
  const rest = text.slice(1);
  const nameCount = new Map<string, number>();
  entries.forEach((e) => nameCount.set(e.name, (nameCount.get(e.name) ?? 0) + 1));

  let best: { entry: T; length: number } | undefined;
  entries.forEach((entry) => {
    const forms = [entry.insertName, entry.addressedName];
    if (nameCount.get(entry.name) === 1) forms.push(entry.name);
    forms.forEach((form) => {
      if (!startsWithWord(rest, form)) return;
      if (!best || form.length > best.length) best = { entry, length: form.length };
    });
  });
  if (!best) return undefined;
  return { entry: best.entry, argsText: rest.slice(best.length).trim() };
};

/**
 * Add the MSC4391 invocation to a message about to be sent, if the bot
 * published a description for the command and the text fits it. Mentions the
 * bot, as the proposal asks, so it knows the block is meant for it.
 *
 * Returns whether the block was added; the text is left as typed either way.
 */
export const addBotInvocation = (
  content: Record<string, unknown>,
  match: CommandMatch<InvocableCommand>,
): boolean => {
  const description = match.entry.msc4391;
  if (!description) return false;
  const args = textToArguments(description, match.argsText);
  if (!args) return false;

  const mentions = (content['m.mentions'] ?? {}) as { user_ids?: string[]; room?: boolean };
  const userIds = mentions.user_ids ?? [];
  content['m.mentions'] = {
    ...mentions,
    user_ids: userIds.includes(match.entry.botUserId)
      ? userIds
      : [...userIds, match.entry.botUserId],
  };
  content[Msc4391.Command] = { command: description.command, arguments: args };
  return true;
};

/** `cmd@localpart rest...`: Telegram's addressing goes on the first word. */
export const addressCommand = (name: string, localpart: string): string => {
  const [first, ...rest] = name.split(' ');
  return [`${first}@${localpart}`, ...rest].join(' ');
};
