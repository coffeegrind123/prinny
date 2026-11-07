# Proposal: Bot message keyboards and callback queries

Draft. Not yet submitted as an MSC; the number is assigned on submission.

Bots on Matrix talk to people through text: the user types `!deploy prod`, the
bot answers with prose. Telegram, Discord and Slack give bots buttons under a
message, quick replies above the composer, and a structured answer to a button
press. This proposal adds those to Matrix, with a plain-text fallback that keeps
every bot usable from a client that implements none of it.

It is the "buttons" follow-up that the author of
[MSC4332](https://github.com/matrix-org/matrix-spec-proposals/pull/4332) left
out of scope
([thread](https://github.com/matrix-org/matrix-spec-proposals/pull/4332#discussion_r2899525051)),
and it builds on the command invocations of
[MSC4391](https://github.com/matrix-org/matrix-spec-proposals/pull/4391).

The design follows the Telegram Bot API field for field wherever Telegram has an
equivalent, so that bot authors and bridges (mautrix-telegram and others) can
map it directly. It has been implemented and in use since 2026 in the Prinny
client and the `@prinny/bot` library, under the unstable prefix below.

## Proposal

### Overview

| Piece | Kind | Sent by |
|---|---|---|
| `m.bot.reply_markup` | content key on any event | bot |
| `m.bot.plain_body`, `m.bot.plain_formatted_body` | content keys | bot |
| `m.bot.callback` | room event, custom relation | client |
| `m.bot.callback_answer` | room event, custom relation | bot |
| `m.bot.keyboard` | room account data | client |

### Keyboards: `m.bot.reply_markup`

`m.bot.reply_markup` is a content key, not an event type. It may ride on any
event the bot sends, usually an `m.room.message` (including `m.image` and other
msgtypes). Its value is exactly one of four shapes, told apart by which key is
present: `inline_keyboard`, `keyboard`, `remove_keyboard` or `force_reply`. A
markup object containing more than one of those keys is invalid, and clients
MUST ignore it entirely rather than apply part of it.

#### Inline keyboard: buttons under the message

```json5
{
  "msgtype": "m.text",
  "body": "Deploy to production?\n\n[1] Deploy\n[2] Cancel\n[3] Docs - https://example.org/docs",
  "m.bot.plain_body": "Deploy to production?",
  "m.bot.reply_markup": {
    "inline_keyboard": [
      [
        { "text": "Deploy", "callback_data": "deploy:prod", "style": "primary" },
        { "text": "Cancel", "callback_data": "cancel", "style": "danger" }
      ],
      [{ "text": "Docs", "url": "https://example.org/docs" }]
    ]
  }
}
```

`inline_keyboard` is an array of rows, each an array of buttons. A button has a
`text` label, an optional `style`, and **exactly one** action:

| Action field | Type | Behaviour |
|---|---|---|
| `callback_data` | string, at most 512 bytes UTF-8 | Sends an `m.bot.callback` (below). |
| `url` | string | Opens a URL after confirmation. Schemes `https:`, `http:` and `matrix:` only. |
| `copy_text` | `{ "text": string }` | Copies the text to the clipboard. |
| `switch_inline_query_current_chat` | string | Puts this text in the composer of the current room, without sending it. |
| `command` | MSC4391 invocation | Sends the command (below). |

`style` is `"default"`, `"primary"` or `"danger"`. Unknown values render as
`default`.

A button carrying no action this client supports (including Telegram fields
with no Matrix meaning, such as `web_app`, `login_url`, `pay` and
`callback_game`) MUST render disabled rather than disappear, so the layout the
bot intended survives.

##### The `command` action

```json5
{
  "text": "Ban spammer",
  "command": {
    "command": "ban",
    "arguments": { "user": "@spam:example.org", "reason": "spam" }
  }
}
```

The value is an MSC4391 `m.bot.command` block. Pressing the button sends an
`m.room.message` from the user, as if they had sent the command themselves:

- the `m.bot.command` block, copied from the button;
- `m.mentions.user_ids` containing the bot (the sender of the keyboard);
- a `body` the client builds from the command (for example
  `/ban @spam:example.org spam`), for clients and bots that read only text.

Unlike `callback_data`, a command is visible in the room and is an ordinary
message from the user. That is the point: it suits actions other members
should see ("Alice banned @spam"), and it lets one button reach a bot that
implements MSC4391 but not this proposal. Clients MUST show the command
(name and arguments) and ask for confirmation before sending it on the user's
behalf, unless the command and arguments are visible on the button itself.

#### Reply keyboard: quick replies above the composer

```json5
{
  "m.bot.reply_markup": {
    "keyboard": [[{ "text": "Status" }, { "text": "Help" }], [{ "text": "Stop" }]],
    "is_persistent": false,
    "resize_keyboard": true,
    "one_time_keyboard": true,
    "input_field_placeholder": "Pick an action",
    "selective": false
  }
}
```

The field names and meanings are Telegram's. Pressing a key sends its `text` as
an ordinary `m.text` message from the user: the bot receives a normal message,
not a callback. `selective: true` means the keyboard is shown only to the users
in the event's `m.mentions.user_ids`. `one_time_keyboard: true` hides it after
one key is used.

#### Removing a reply keyboard, and forcing a reply

```json5
{ "m.bot.reply_markup": { "remove_keyboard": true, "selective": false } }
```

clears the sender's reply keyboard in this room.

```json5
{
  "m.bot.reply_markup": {
    "force_reply": true,
    "input_field_placeholder": "Enter the absolute path",
    "selective": false
  }
}
```

asks the client to focus the composer as a reply to this event, with the
placeholder shown. The user may dismiss it.

#### Remembering the reply keyboard: `m.bot.keyboard`

A reply keyboard outlives the message that delivered it, and a client may not
have that message loaded (after a reload, a sync gap, or a long conversation).
Clients SHOULD record each bot's latest reply-keyboard instruction in room
account data, keyed by the bot's user ID:

```json5
// room account data, type m.bot.keyboard
{
  "@deploybot:example.org": {
    "event_id": "$abc",   // the event carrying the markup
    "ts": 1730000000000,  // its origin_server_ts
    "kind": "keyboard",   // or "remove"
    "dismissed": true,    // optional: the user closed it
    "used": true          // optional: a one_time_keyboard key was pressed
  }
}
```

Only references are stored, never the buttons. Room account data is not
end-to-end encrypted, so copying the markup into it would expose the contents of
an encrypted message to the server. A client that needs the keyboard fetches the
event by ID and decrypts it. A newer instruction from the same bot replaces the
entry and clears both flags. When several bots have keyboards in a room, the
newest instruction is shown. `force_reply` is a one-shot prompt and is not
recorded. Because the record is account data, closing a keyboard or using a
one-time keyboard holds on all the user's devices.

#### Editing a keyboard

There is no dedicated edit event. A bot changes or removes a keyboard with an
ordinary `m.replace` edit:

```json5
{
  "msgtype": "m.text",
  "body": "* Deploying...",
  "m.new_content": {
    "msgtype": "m.text",
    "body": "Deploying...",
    "m.bot.reply_markup": { "inline_keyboard": [[{ "text": "Cancel", "callback_data": "abort" }]] }
  },
  "m.relates_to": { "rel_type": "m.replace", "event_id": "$original" }
}
```

Clients MUST read the markup from the latest valid edit, and MUST ignore edits
whose sender differs from the original event's sender (as the spec already
requires for edits). An edit whose `m.new_content` has no `m.bot.reply_markup`
removes the keyboard.

### Callback queries

#### `m.bot.callback`, sent by the client

```json5
{
  "type": "m.bot.callback",
  "content": {
    "m.relates_to": { "rel_type": "m.bot.callback", "event_id": "$message_with_keyboard" },
    "id": "c8a1f0e2-5b7d-4f3e-9a51-0e7c8d2b6f14",
    "data": "deploy:prod",
    "button": [0, 0]
  }
}
```

| Field | Notes |
|---|---|
| `id` | Generated by the client, unique per press. The answer refers to it. |
| `data` | The pressed button's `callback_data`, verbatim. |
| `button` | Zero-based `[row, column]`, so a bot can tell identically labelled buttons apart. |

The relation uses its own `rel_type` instead of `m.reference`, so that callback
traffic does not appear in a client's reference aggregations. The callback is
sent into the room the keyboard is in, never elsewhere. In an encrypted room it
is encrypted like any other event.

#### `m.bot.callback_answer`, sent by the bot

```json5
{
  "type": "m.bot.callback_answer",
  "content": {
    "m.relates_to": { "rel_type": "m.bot.callback_answer", "event_id": "$the_callback" },
    "id": "c8a1f0e2-5b7d-4f3e-9a51-0e7c8d2b6f14",
    "text": "Deploying to production...",
    "show_alert": false,
    "url": "https://ci.example.org/run/42"
  }
}
```

This is Telegram's `answerCallbackQuery`. Everything except `m.relates_to` and
`id` is optional. `text` is shown as a short notification; `show_alert: true`
shows it as a dialog the user must dismiss. `url`, if present, is offered behind
the same confirmation as a URL button and never opened automatically. Clients
MUST ignore an answer whose sender is not the sender of the keyboard.

#### Lifecycle

1. The user presses a button. The client sends `m.bot.callback` and shows the
   button as pending.
2. The bot handles it and sends `m.bot.callback_answer`.
3. The client clears the pending state and shows `text`, if any.
4. If no answer arrives within 15 seconds, the client clears the pending state
   and may show a quiet "no response" hint. It MUST NOT resend.

Bots SHOULD answer every callback, even with no text, since the pending state
is the user's only sign that the press registered. Clients MUST debounce, so a
double click or held key sends one callback.

### Plain-text fallback

This is what makes the feature safe on a federated network: a user on a client
that implements none of this must still be able to answer the bot.

For an inline keyboard, the bot writes a numbered list of its callback and URL
buttons into `body` (and `formatted_body`), and puts the text without the list
in `m.bot.plain_body` (and `m.bot.plain_formatted_body`):

```
Deploy to production?

[1] Deploy
[2] Cancel
[3] Docs - https://example.org/docs
```

A client that renders the keyboard shows `plain_body` and never the list. A
client that does not shows `body`, and the user answers `1` or `Deploy`. Bot
libraries SHOULD map such a text reply back to the button it names, so the
bot's callback handler and text handler are the same code. Reply keyboards get
the same treatment with their key labels. `remove_keyboard` and `force_reply`
need no fallback.

An explicit clean copy is used rather than "strip the last N lines", because a
bot that miscounts would leave a stray `[2] Cancel` in the rendered message with
no way for the client to notice.

### Limits

| Limit | Value |
|---|---|
| `callback_data` | 512 bytes UTF-8 |
| Button `text` | 64 characters |
| Rows per keyboard | 10 |
| Buttons per row | 8 |
| `input_field_placeholder` | 64 characters |
| Answer `text` | 200 characters |

Clients MUST enforce these by truncating (excess rows, buttons and characters),
not by refusing the whole keyboard, except for the ambiguous markup case above.

### Client obligations

A client that renders keyboards MUST:

- render markup only from the event's own sender;
- treat every string (labels, placeholders, answer text) as plain text, never
  HTML or Markdown;
- strip bidirectional override and isolate characters, and control characters,
  from labels, so a label cannot visually swap the position of two buttons;
- confirm before opening any URL, showing the full resolved host, on every
  press (never "remember" a confirmation);
- render buttons with other URL schemes as disabled;
- send callbacks only on a direct user action: no automatic presses, no
  prefetching of URL targets;
- offer a setting to turn keyboard rendering off, falling back to `body`.

## Potential issues

- **Callback traffic is room traffic.** Every press is an event in the room's
  history, visible to all members (in encrypted rooms, to all members' devices).
  This matches how bots already work on Matrix (the press replaces a typed
  command, which was also visible) but is noisier than Telegram, where callbacks
  are private to the bot. A client MAY hide `m.bot.callback` and
  `m.bot.callback_answer` events from the timeline.
- **No server-side delivery guarantee.** If the bot is offline, the callback
  waits in the room. The 15-second timeout covers the UI; the bot may still act
  on the press much later. Bots SHOULD ignore callbacks older than they consider
  meaningful.
- **Duplication.** `body` and `m.bot.plain_body` cost a few hundred bytes per
  keyboard message. The alternative (trailing-line counting) fails silently.
- **`selective` relies on mentions.** A bot that forgets to mention the target
  shows the keyboard to nobody.

## Alternatives

- **[MSC4139](https://github.com/matrix-org/matrix-spec-proposals/pull/4139)
  (bot buttons and conversations)** defines an `m.prompts` mixin on extensible
  events. A pressed prompt is answered with an `m.conversation.reply` in a
  thread. It has no URL, copy or prefill buttons, no reply keyboards, no
  answer from the bot to a press, no edit semantics, and depends on extensible
  events. Its own Potential issues and Security sections are still "TODO". This
  proposal covers its use cases (a `callback_data` button is a `preset` prompt;
  a `force_reply` is close to an `input` prompt) and keeps working in today's
  room versions. If accepted, this proposal supersedes it.
- **[MSC1485](https://github.com/matrix-org/matrix-spec-proposals/issues/3812)
  (hint buttons in messages)** is an early proposal for buttons in messages,
  based on a Riot Web pull request (matrix-org/matrix-react-sdk#2109). Its text
  lives in an external document, and it has stayed an open issue since 2018
  without a proposal pull request. Its use
  case, buttons a user can press instead of typing, is covered here, and this
  proposal supersedes it.
- **[MSC3006](https://github.com/matrix-org/matrix-spec-proposals/pull/3006)**
  (bot interactions in state events) describes conversation starters, not
  per-message buttons.
- **Reactions as buttons**, which bots use today, give no labels beyond an emoji,
  no answer, and leave a permanent reaction per press.
- **Widgets** can render arbitrary UI but need a web server per bot, are not
  rendered inline with the message, and are far heavier to trust.

## Security considerations

- **Phishing through URL buttons.** A label can say anything. Clients MUST show
  the real host and ask before opening, on every press, and MUST refuse schemes
  other than `https:`, `http:` and `matrix:`. A `matrix:` URL that would cause
  an action (joining a room, starting a chat) goes through that action's own
  confirmation.
- **Spoofed keyboards.** Only the event's sender may attach or change markup,
  and only the keyboard sender's answers count, so another room member cannot
  inject buttons into a bot's message or answer for the bot.
- **Visual confusion.** Bidirectional overrides in a label can reorder what the
  user sees ("Cancel" drawn where "Deploy" is). Clients MUST strip them.
- **Commands sent in the user's name.** A `command` button posts a visible
  message from the user. Clients MUST make the command visible before sending
  it, so a bot cannot make a user appear to issue a command they never saw.
- **Leaking encrypted content.** The `m.bot.keyboard` record stores references
  only. Clients MUST NOT copy markup into unencrypted account data.
- **Resource exhaustion.** The limits bound what one event can make a client
  render.
- **Callbacks are data the bot must validate.** `callback_data` comes back from
  an untrusted client. Bots MUST treat it as user input (a user can send any
  `data` and any `button` position), never as proof that a button existed.

## Unstable prefix

Until this proposal is accepted, implementations use the identifiers Prinny
already ships:

| Stable | Unstable |
|---|---|
| `m.bot.reply_markup` | `app.prinny.bot.reply_markup` |
| `m.bot.plain_body` | `app.prinny.bot.plain_body` |
| `m.bot.plain_formatted_body` | `app.prinny.bot.plain_formatted_body` |
| `m.bot.callback` (event type and `rel_type`) | `app.prinny.bot.callback` |
| `m.bot.callback_answer` (event type and `rel_type`) | `app.prinny.bot.callback_answer` |
| `m.bot.keyboard` | `app.prinny.bot.keyboard` |

The `command` button action uses MSC4391's unstable block,
`org.matrix.msc4391.command`, until that proposal is stable. The current
implementation predates the `command` action and does not send it yet.

## Dependencies

- [MSC4391](https://github.com/matrix-org/matrix-spec-proposals/pull/4391), for
  the `command` button action only. Everything else stands alone.
