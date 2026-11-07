# Proposal: Bot profile, menu and identification

Draft. Not yet submitted as an MSC; the number is assigned on submission.

[MSC4391](https://github.com/matrix-org/matrix-spec-proposals/pull/4391) lets a
bot describe its commands, one state event per command. It leaves out what a
client needs to present the bot as a whole: a name and description for a
profile card, which command to show first, a menu button next to the composer,
whether the bot reads every message, and how to tell that an account is a bot
at all. It also has no answer for a bot that lacks the power to send state,
which is the usual case for a bot invited into someone else's room.

This proposal is a companion to MSC4391 that fills those gaps. It revives the
member flag of [MSC4015](https://github.com/matrix-org/matrix-spec-proposals/pull/4015),
which was closed without being rejected. It is implemented in the Prinny client
and the `@prinny/bot` library under the unstable names below.

## Proposal

### Bot profile: `m.bot.profile`

A state event, `state_key` set to the bot's own user ID:

```json5
{
  "type": "m.bot.profile",
  "state_key": "@deploybot:example.org",
  "sender": "@deploybot:example.org",
  "content": {
    "name": "Deploy Bot",
    "short_description": "Ships builds from chat",
    "description": "Runs deployments for this team. Send /deploy to start.",
    "commands": ["deploy", "status", "rollback"],
    "menu_button": { "type": "commands" },
    "privacy_mode": true
  }
}
```

| Field | Type | Meaning |
|---|---|---|
| `name` | string | Name for the bot's card. Falls back to the member display name. |
| `short_description` | string, at most 120 characters | One line, e.g. under the name in a member list. |
| `description` | string, at most 512 characters | Longer text for the profile card, or shown in an empty DM with the bot. |
| `commands` | array of strings | The order to show the bot's MSC4391 commands in. Each entry is the `command` of one of the bot's descriptions. |
| `menu_button` | object | What the button next to the composer does (below). |
| `privacy_mode` | boolean | The bot says it only reads messages addressed to it. Advisory. |

All fields are optional. Clients MUST ignore the event when its `state_key` is
not its `sender`: a profile only speaks for the account that sent it.

`commands` only orders; the commands themselves are MSC4391 descriptions.
Commands with a description but not in the list follow those in the list, in a
client-chosen stable order. Entries that name no description are ignored.

`menu_button` is one of:

- `{ "type": "commands" }`: open the bot's command list;
- `{ "type": "default" }`: the client's default (usually nothing);
- `{ "type": "url", "text": "Dashboard", "url": "https://example.org" }`: open a
  URL, with the same scheme restriction (`https:`, `http:`, `matrix:`) and the
  same confirmation as a URL button in [P1](./P1-bot-keyboards-and-callbacks.md).

The content is Telegram's `setMyName`, `setMyShortDescription`,
`setMyDescription` and `setChatMenuButton`, so a bridge or a bot ported from
Telegram maps them one to one.

### Without power to send state: the timeline form

Sending state needs power level 50 in most rooms, and a bot invited into
someone else's room usually has 0. Such a bot sends the same content as an
ordinary room event of type `m.bot.profile`, with no `state_key`.

- Clients that see it keep the most recent one per `(room, sender)` and treat
  it as that bot's profile.
- The state event, when present, always wins.
- Bots SHOULD resend the timeline form when they join and whenever the profile
  changes.
- Clients MUST NOT paginate back through history looking for one. A bot that
  never resends has no profile in that room, and that is a correct outcome.

MSC4391 descriptions have no timeline form. A bot without state power therefore
has no command schemas, and its commands appear as plain names: the timeline
form MAY carry a fallback list of command names and descriptions for exactly
this case:

```json5
{
  "type": "m.bot.profile",
  "content": {
    "name": "Deploy Bot",
    "command_fallback": [
      { "command": "deploy", "description": "Deploy a build", "args": "<env> [build]" }
    ]
  }
}
```

`command_fallback` entries follow Telegram's `BotCommand` (`command` matching
`^[a-z0-9_]{1,32}$`, `description` at most 256 characters) plus an `args` usage
hint of at most 64 characters. A client offers them as text commands (sent as
`/command args`, with no MSC4391 block). Clients MUST ignore `command_fallback`
for a bot that has MSC4391 descriptions in the room.

### Identifying a bot

There is no notion of a bot account in Matrix. A client treats a user as a bot
in a room if any of these holds:

1. they have a `m.bot.profile` (state or timeline form) in the room;
2. they sent an MSC4391 command description in the room;
3. their `m.room.member` content has `"bot": true` (MSC4015's flag).

The member flag is the one that works without power: anyone may change their
own member event. Bot frameworks SHOULD set it in every room they join, keeping
the rest of the member content (display name, avatar) unchanged.

All three signals are claims the account makes about itself. Clients MAY show a
"bot" badge for them, and MUST NOT present that badge as verified.

### Hiding departed bots

A bot's profile and descriptions stay in room state after it leaves. Clients
MUST NOT offer the commands or menu button of a user whose membership is not
`join`. A badge on the departed bot's old messages may stay.

## Potential issues

- **Power levels.** The state form needs power the bot often lacks; the timeline
  form covers it but is lost from view once it scrolls beyond what a client
  loads, and costs one event per change per room.
- **Two places for commands.** A bot with state power publishes the profile once
  and one MSC4391 event per command. That is more events than a single list, in
  exchange for MSC4391's per-command schemas and conflict-free keys.
- **Self-assertion.** Anyone can claim to be a bot. The badge informs; it does
  not authenticate.

## Alternatives

- **Putting profile fields into MSC4391 itself.** MSC4391 is deliberately small
  and per-command. A per-bot event keeps it that way and lets this proposal move
  independently.
- **Extensible profiles ([MSC4133](https://github.com/matrix-org/matrix-spec-proposals/pull/4133)).**
  Global profile fields would avoid per-room state, but a bot's menu and
  privacy mode can differ between rooms, profile fields are not readable on
  every homeserver for remote users, and they cannot express the per-room
  fallback.
- **MSC4015 alone.** A member flag says "bot" but carries nothing a client can
  show. This proposal keeps the flag as the minimal signal.
- **Per-room account data written by each user's client.** Puts the burden on
  every user instead of the bot.

## Security considerations

- **Impersonation.** A profile is accepted only from its own `state_key`
  account, so one member cannot publish a profile or command order for another.
- **Menu URL.** The `url` menu button is subject to the same scheme allow-list
  and per-press confirmation as P1's URL buttons, showing the real host.
- **Text fields.** Name and descriptions are plain text, never HTML. Clients
  MUST strip bidirectional overrides and control characters, and enforce the
  length limits by truncation.
- **Command name clashes.** A bot may name a command after a client's built-in
  one. MSC4391's rules apply: clients SHOULD show the bot's name next to its
  commands, and built-in commands take precedence or require the bot to be
  addressed explicitly (`/status@deploybot`).
- **Timeline form spam.** A user can post `m.bot.profile` events. They only
  ever describe the sender and only the latest per sender counts, so this
  cannot affect another account.

## Unstable prefix

| Stable | Unstable (as shipped) |
|---|---|
| `m.bot.profile` | `app.prinny.bot.info`, with `"version": 1` |
| `commands` (order) | `commands` (array of `{command, description, args?}`; the order is the array's) |
| `command_fallback` | the same `commands` array, used when the bot has no MSC4391 descriptions |
| `bot` member flag | `app.prinny.bot`, and MSC4015's `dev.nordgedanken.msc4015`, both read |

The shipped format combines ordering and the fallback list in one `commands`
array of full command entries, because it predates MSC4391. Implementations of
the unstable form read `commands` for both purposes; the stable form splits them
so that a bot with descriptions publishes only names.

## Dependencies

- [MSC4391](https://github.com/matrix-org/matrix-spec-proposals/pull/4391): the
  command descriptions this proposal orders and complements.
- [P1](./P1-bot-keyboards-and-callbacks.md), for the URL confirmation rules the
  menu button reuses.
