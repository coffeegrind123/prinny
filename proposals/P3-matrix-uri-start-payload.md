# Proposal: Start payload for `matrix:` chat links

Draft. Not yet submitted as an MSC; the number is assigned on submission.

Telegram bots hand out links like `https://t.me/examplebot?start=invite_abc`.
Opening one starts a chat with the bot and sends `/start invite_abc`, so the
bot knows which invitation, campaign or account-linking request the user came
from. It is how bots onboard people: "click here to connect your account".

The `matrix:` URI scheme ([MSC2312](https://github.com/matrix-org/matrix-spec-proposals/pull/2312),
merged) already has `action=chat`, which opens a direct chat with a user. This
proposal adds a payload to it that the client delivers to the bot once the chat
is open.

## Proposal

### The link

```
matrix:u/deploybot:example.org?action=chat&start=invite_abc
```

`start` is a new query parameter on `matrix:u/...` URIs with `action=chat`:

- Its value MUST match `^[A-Za-z0-9_-]{1,64}$` (Telegram's rule). The limited
  character set means it survives every URL and QR-code path unescaped.
- It is only meaningful together with `action=chat` on a user URI. Clients MUST
  ignore it anywhere else.
- A client that does not understand `start` still opens the chat, which is the
  correct degraded behaviour.

### What the client does

1. Show the user who the chat is with (the full user ID, not just a display
   name) and what will be sent, and ask for confirmation. A link is an
   invitation, not an instruction.
2. Open the existing direct chat with that user, or create one as `action=chat`
   already does.
3. Send the payload to the bot, in one of two forms:
   - if the bot has published an MSC4391 description for a `start` command,
     an `m.room.message` with body `/start <payload>`, `m.mentions` naming the
     bot, and the invocation block
     `{"command": "start", "arguments": {"payload": "<payload>"}}`, where the
     argument key is the description's first parameter (or `payload` if it has
     none);
   - otherwise a plain `m.room.message` with body `/start <payload>`.

For a newly created room the client cannot yet see the bot's descriptions, as
the bot has not joined. It SHOULD send the plain form. Bots SHOULD accept both
forms.

A link without `start` keeps MSC2312's meaning exactly: open the chat, send
nothing.

### Bot side

A bot that wants deep links:

- builds `matrix:u/<its user id without @>?action=chat&start=<payload>`;
- handles `/start` with and without an argument (without one, the user opened
  the chat some other way);
- treats the payload as untrusted input: anyone can craft a link with any
  payload, so a payload is a lookup key, never a credential on its own.

## Potential issues

- **Clients that drop unknown parameters** open the chat but send nothing. The
  user then has to type `/start` themselves, and the payload is lost. This is
  no worse than today.
- **Who is a bot.** Nothing in the URI says the target is a bot. The payload is
  what turns a chat link into a bot link: a client MUST NOT send `/start` for a
  link without one, since `action=chat` links to people are common.
- **Re-opening.** Opening the same link twice sends `/start <payload>` twice
  (after two confirmations). Bots SHOULD make `/start` handling idempotent.

## Alternatives

- **An https link to a client-specific page** (`https://prinny.app/bot/...`,
  which Prinny also accepts). Works only for that client and needs the user to
  have it.
- **A custom URL scheme per client** (`prinny://bot/...`). Same problem.
- **Putting the payload in the room the client creates** (as an initial state
  event or in the invite). Would need server or room-creation changes, and does
  not work when a direct chat already exists.
- **MSC4391 command links** that encode any command and arguments. More general
  and much more dangerous: a link could make the user send any command to any
  bot. `/start` with a restricted payload is deliberately the only thing a link
  can send.

## Security considerations

- **Sending messages on the user's behalf.** The confirmation in step 1 is
  mandatory, shows the target's full user ID and the exact message, and is
  shown on every link. A link opened from outside the client (another app, a
  QR code) goes through the same dialog.
- **Payload injection.** The character set excludes whitespace and markup, so a
  payload cannot add arguments, mentions or formatting to the message. Clients
  MUST reject (not truncate or escape) a non-matching payload, and decode the
  URI exactly once, so a double-encoded value cannot smuggle characters past the
  check.
- **Spoofed targets.** The confirmation shows the user ID because display names
  can imitate a well-known bot.
- **Tracking.** A payload can identify where a user came from. That is its
  purpose, and the user sees it before it is sent.

## Unstable prefix

Until accepted, the parameter is `app.prinny.bot.start` instead of `start`:

```
matrix:u/deploybot:example.org?action=chat&app.prinny.bot.start=invite_abc
```

Prinny reads and `@prinny/bot` builds this form today, alongside the
client-specific forms `https://prinny.app/bot/@deploybot:example.org?start=invite_abc`
and `prinny://bot/@deploybot:example.org?start=invite_abc`. Prinny currently
always sends the plain `/start <payload>` form.

## Dependencies

- [MSC2312](https://github.com/matrix-org/matrix-spec-proposals/pull/2312)
  (merged), for `action=chat`.
- [MSC4391](https://github.com/matrix-org/matrix-spec-proposals/pull/4391) for
  the structured form of the `/start` message. Optional: the plain form works
  without it.
