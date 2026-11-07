import { describe, expect, it } from 'vitest';
import type { MatrixEvent } from 'matrix-js-sdk';
import { Msc4391, type Msc4391CommandDescription } from '../../types/matrix/bot';
import {
  addBotInvocation,
  addressCommand,
  argsHintOf,
  collectDescriptions,
  findBotCommand,
  textToArguments,
  type InvocableCommand,
} from './botInvocation';
import { hasBotMemberFlag } from './botPresence';

const BOT = '@bot:hs';

const stateEvent = (sender: string, content: Record<string, unknown>) =>
  ({ getSender: () => sender, getContent: () => content }) as unknown as MatrixEvent;

// What @prinny/bot publishes for `{ command: 'echo', args: '<text>' }`
const echo: Msc4391CommandDescription = {
  command: 'echo',
  description: { 'm.text': [{ body: 'Repeat' }] },
  parameters: [
    {
      key: 'args',
      schema: { schema_type: 'primitive', type: 'string' },
      optional: true,
      description: { 'm.text': [{ body: '<text>' }] },
    },
  ],
  [Msc4391.TailParameter]: 'args',
};

const ban: Msc4391CommandDescription = {
  command: 'ban',
  parameters: [
    { key: 'room', schema: { schema_type: 'primitive', type: 'room_id' } },
    { key: 'timeout', schema: { schema_type: 'primitive', type: 'integer' }, optional: true },
    { key: 'policy', schema: { schema_type: 'primitive', type: 'boolean' }, optional: true },
    {
      key: 'users',
      schema: { schema_type: 'array', items: { schema_type: 'primitive', type: 'user_id' } },
    },
  ],
};

describe('collectDescriptions', () => {
  it('groups by sender, drops withdrawn and invalid ones, and sorts by command', () => {
    const bots = collectDescriptions([
      stateEvent(BOT, { command: 'zeta' }),
      stateEvent(BOT, { command: 'alpha' }),
      stateEvent(BOT, {}),
      stateEvent(BOT, {
        command: 'dup',
        parameters: [
          { key: 'a', schema: { schema_type: 'primitive', type: 'string' } },
          { key: 'a', schema: { schema_type: 'primitive', type: 'string' } },
        ],
      }),
      stateEvent('@other:hs', { command: 'alpha' }),
    ]);
    expect(bots.get(BOT)?.map((d) => d.command)).toEqual(['alpha', 'zeta']);
    expect(bots.get('@other:hs')?.map((d) => d.command)).toEqual(['alpha']);
  });
});

describe('argsHintOf', () => {
  it('shows required, optional and repeated parameters', () => {
    expect(argsHintOf(ban)).toBe('<room> [timeout] [policy] <users...>');
    expect(argsHintOf({ command: 'ping' })).toBeUndefined();
  });
});

describe('textToArguments', () => {
  it('gives the tail parameter the rest of the line verbatim', () => {
    expect(textToArguments(echo, 'hello   "world"')).toEqual({ args: 'hello   "world"' });
    expect(textToArguments(echo, '')).toEqual({});
  });

  it('fills typed parameters in order, skipping optional ones that do not fit', () => {
    expect(textToArguments(ban, '!r:hs 42 @a:hs @b:hs')).toEqual({
      room: { type: 'room_id', id: '!r:hs' },
      timeout: 42,
      users: ['@a:hs', '@b:hs'],
    });
    expect(textToArguments(ban, '!r:hs yes @a:hs')).toEqual({
      room: { type: 'room_id', id: '!r:hs' },
      policy: true,
      users: ['@a:hs'],
    });
  });

  it('accepts links where an ID is expected, keeping the via servers', () => {
    expect(
      textToArguments(ban, 'https://matrix.to/#/!r:hs?via=hs&via=o.hs https://matrix.to/#/@a:hs'),
    ).toEqual({
      room: { type: 'room_id', id: '!r:hs', via: ['hs', 'o.hs'] },
      users: ['@a:hs'],
    });
  });

  it('gives up, so only the text is sent, when the text does not fit', () => {
    expect(textToArguments(ban, '')).toBeNull(); // required missing
    expect(textToArguments(ban, 'not-a-room @a:hs')).toBeNull(); // wrong type
    expect(textToArguments(ban, '!r:hs @a:hs not-a-user')).toBeNull(); // bad array item
    expect(textToArguments({ command: 'ping' }, 'extra')).toBeNull(); // no place for it
  });

  it('reads quoted phrases, literals and unions', () => {
    const mode: Msc4391CommandDescription = {
      command: 'mode',
      parameters: [
        {
          key: 'level',
          schema: {
            schema_type: 'union',
            variants: [
              { schema_type: 'literal', value: 'off' },
              { schema_type: 'primitive', type: 'integer' },
            ],
          },
        },
        { key: 'note', schema: { schema_type: 'primitive', type: 'string' } },
      ],
    };
    expect(textToArguments(mode, 'OFF "two words"')).toEqual({ level: 'off', note: 'two words' });
    expect(textToArguments(mode, '3 x')).toEqual({ level: 3, note: 'x' });
    expect(textToArguments(mode, 'high x')).toBeNull();
  });
});

describe('findBotCommand and addBotInvocation', () => {
  const entries: InvocableCommand[] = [
    {
      name: 'echo',
      botUserId: BOT,
      insertName: 'echo',
      addressedName: 'echo@bot',
      msc4391: echo,
    },
    { name: 'rooms', botUserId: BOT, insertName: 'rooms', addressedName: 'rooms@bot' },
    {
      name: 'rooms add',
      botUserId: '@other:hs',
      insertName: 'rooms add',
      addressedName: 'rooms@other add',
      msc4391: {
        command: 'rooms add',
        [Msc4391.TailParameter]: 'r',
        parameters: [
          { key: 'r', schema: { schema_type: 'primitive', type: 'string' }, optional: true },
        ],
      },
    },
    { name: 'status', botUserId: BOT, insertName: 'status@bot', addressedName: 'status@bot' },
    {
      name: 'status',
      botUserId: '@other:hs',
      insertName: 'status@other',
      addressedName: 'status@other',
    },
  ];

  it('matches the inserted, addressed or unique bare name; the longest wins', () => {
    expect(findBotCommand(entries, '/echo hi')).toMatchObject({
      entry: { name: 'echo' },
      argsText: 'hi',
    });
    expect(findBotCommand(entries, '/echo@bot hi')).toMatchObject({ entry: { name: 'echo' } });
    expect(findBotCommand(entries, '/rooms add !x:hs')).toMatchObject({
      entry: { name: 'rooms add' },
      argsText: '!x:hs',
    });
    expect(findBotCommand(entries, '/rooms list')).toMatchObject({ entry: { name: 'rooms' } });
    expect(findBotCommand(entries, '/echoes')).toBeUndefined();
  });

  it('does not guess between two bots offering the same name', () => {
    expect(findBotCommand(entries, '/status')).toBeUndefined();
    expect(findBotCommand(entries, '/status@other')).toMatchObject({
      entry: { botUserId: '@other:hs' },
    });
  });

  it('adds the block and mentions the bot, keeping the text and other mentions', () => {
    const content: Record<string, unknown> = {
      body: '/echo hi there',
      'm.mentions': { user_ids: ['@alice:hs'] },
    };
    expect(addBotInvocation(content, findBotCommand(entries, '/echo hi there')!)).toBe(true);
    expect(content).toEqual({
      body: '/echo hi there',
      'm.mentions': { user_ids: ['@alice:hs', BOT] },
      [Msc4391.Command]: { command: 'echo', arguments: { args: 'hi there' } },
    });
  });

  it('leaves the message alone for a bot without a description, or text that does not fit', () => {
    const content: Record<string, unknown> = { body: '/rooms', 'm.mentions': {} };
    expect(addBotInvocation(content, findBotCommand(entries, '/rooms')!)).toBe(false);
    expect(content).toEqual({ body: '/rooms', 'm.mentions': {} });
  });

  it('addresses the first word of a subcommand', () => {
    expect(addressCommand('rooms add', 'bot')).toBe('rooms@bot add');
  });
});

describe('hasBotMemberFlag', () => {
  it('reads our flag and both forms of MSC4015', () => {
    expect(hasBotMemberFlag({ 'app.prinny.bot': true })).toBe(true);
    expect(hasBotMemberFlag({ bot: true })).toBe(true);
    expect(hasBotMemberFlag({ 'dev.nordgedanken.msc4015': true })).toBe(true);
    expect(hasBotMemberFlag({ bot: 'yes' })).toBe(false);
    expect(hasBotMemberFlag(undefined)).toBe(false);
  });
});
