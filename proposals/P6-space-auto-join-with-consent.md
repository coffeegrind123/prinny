# Proposal: Space auto-join with per-user consent

Draft. Not yet submitted as an MSC; the number is assigned on submission.

Joining a space does not join its rooms. A member has to open the space and
join each room by hand, and when an administrator adds a room later, members
do not find out unless they look. Communities moving from Discord expect
"join the server, see the channels".

[MSC1772](https://github.com/matrix-org/matrix-spec-proposals/pull/1772)
(merged) sketched this under "Future extensions", in its section "Auto-joined
children":

> We could add an `auto_join` flag to `m.space.child` events to allow a space
> admin to list the sub-spaces and rooms in that space which should be
> automatically joined by members of that space.
>
> This would be distinct from a force-join: the user could subsequently part
> any auto-joined room if they desire.

and warned:

> Obviously auto-joining can be a DoS vector, and we consider it to be
> antisocial for a space to try to autojoin its members to more than 100
> children (in total).

This proposal specifies it with one change in principle: the space can only
**ask**. Whether a client joins anything is decided by the user, in their own
account data, and a room the user left is never joined back.

## Proposal

Three pieces:

1. A space state event in which administrators ask members' clients to
   auto-join the space's children.
2. A global account data event holding the user's consent: off, only spaces
   that ask, or all spaces, plus per-space overrides.
3. A global account data event listing rooms the user left, which auto-join
   must not rejoin.

### 1. The space's request: `m.space.auto_join`

A state event in the space room, with an empty state key:

```json5
{
  "type": "m.space.auto_join",
  "state_key": "",
  "content": {
    "auto_join": true
  }
}
```

- `auto_join: true` means the space asks members' clients to join its
  children. Anything else (absent, `false`, a non-boolean, no event) means it
  does not ask.
- The request covers the whole space, including rooms added later and the
  children of its subspaces (see "What gets joined").
- It is ordinary state, so it is power-gated like any other state event. With
  default power levels, sending it needs the `state_default` level.
- There is no per-child form. MSC1772's sketch put a flag on each
  `m.space.child`; this proposal does not, because a per-child flag makes the
  child list itself the thing a moderator has to audit, and every child edit
  a potential change in what members' clients join. A space that wants only
  some rooms auto-joined can put the rest in a subspace that does not ask.

### 2. The user's consent: `m.auto_join`

Global account data:

```json5
{
  "type": "m.auto_join",
  "content": {
    "mode": "requested",
    "spaces": {
      "!gaming:example.org": true,     // always, even though it does not ask
      "!work:example.org": false       // never, even though it asks
    }
  }
}
```

| Key | Type | Description |
| --- | --- | --- |
| `mode` | `"off"`, `"requested"` or `"all"` | `off`: never auto-join. `requested`: auto-join spaces whose `m.space.auto_join` asks. `all`: auto-join every joined space. |
| `spaces` | object, room ID → boolean | Per-space overrides that beat `mode`: `true` always auto-joins that space, `false` never does. |

The decision for a joined space `S`:

```
spaces[S] is true            -> join S's children
spaces[S] is false           -> do not
otherwise, mode is "all"     -> join
otherwise, mode is "requested" and S asks (m.space.auto_join.auto_join == true) -> join
otherwise                    -> do not
```

Rules:

- A `mode` the client does not recognise MUST be treated as `off`. A newer
  client may add modes; an older client must fail closed, not open.
- `spaces` keys that are not room IDs, and values that are not booleans, MUST
  be ignored.
- When the event is absent, the client uses its own default. That default
  SHOULD be `off`.
- Clients SHOULD preserve keys they do not understand when they rewrite the
  event.
- A `false` override on a **subspace** also holds when an ancestor space is
  auto-joined: the client does not join that subspace, and does not descend
  into it.

### 3. Rooms the user left: `m.auto_join.left_rooms`

Global account data:

```json5
{
  "type": "m.auto_join.left_rooms",
  "content": {
    "rooms": {
      "!offtopic:example.org": 1770140640000,   // ms, when the leave was recorded
      "!memes:example.org": 1770000000000
    }
  }
}
```

- A client MUST NOT auto-join a room listed in `rooms`. It MAY still show the
  room, and the user MAY join it manually.
- A client SHOULD add a room when the user's membership goes from `join` to
  `leave`, whichever client or user caused it. That includes a leave made on
  another client and a kick: a kicked user's client must not rejoin
  automatically either.
- When the client itself leaves a room on the user's request, it SHOULD write
  the mark **before** sending the leave. The leave's sync can re-run
  auto-join before a mark written afterwards has come back. If the leave then
  fails, the client SHOULD remove the mark again.
- A client SHOULD remove a room when the user joins it again (membership goes
  to `join` from anything else). Rejoining is the user taking the decision
  back.
- The list is bounded. When adding would exceed the limit, the client
  evicts the entries with the oldest timestamps first. Clients SHOULD cap it
  at a number of entries and at an encoded size, so the event stays well
  below the size limits homeservers apply in practice. The spec sets no limit
  on account data size; Prinny's limits are given below.
- Values that are not numbers MUST be ignored.

### What gets joined

For every joined space whose decision (above) is "join", the client walks its
`m.space.child` events:

- Children without a valid `via` (absent or not an array) are ignored, as
  MSC1772 says.
- A child that is in `m.auto_join.left_rooms` and not currently joined is
  skipped.
- A child room is joined using the `via` servers from its `m.space.child`
  event.
- A child that is a space is joined too, unless the user has a `false`
  override for it. Once joined, its own children are walked in the same way.
- Each room is attempted at most once per session. A join that fails (invite
  only, server unreachable) is not retried automatically; the user can still
  join from the space's room list.
- Joins SHOULD be rate-limited and SHOULD back off on `M_LIMIT_EXCEEDED`.
- The client re-evaluates when an `m.space.auto_join` or `m.space.child`
  event arrives, when the user joins a room (a newly joined subspace may have
  children), and when the user's `m.auto_join` or `m.auto_join.left_rooms`
  changes.

### Normative rule: a room event alone never causes a join

**A client MUST NOT join any room because of a room event alone.** Room
state is written by whoever has power in that room, and `m.space.child`
`via` servers are chosen by whoever sent the event. If `m.space.auto_join` by
itself could make clients join, anyone with state power in a space could make
every member's client join rooms of their choosing, through servers of their
choosing, and leak each member's server and IP to those servers. Only the
user's own account data (`mode` and `spaces`) can turn auto-join on. The
space's event matters only when the user chose `requested`, or as a hint the
client shows in its UI.

### Size

MSC1772 calls auto-joining more than 100 children "antisocial". Clients
SHOULD NOT auto-join more than 100 rooms for one space without asking the
user first, and SHOULD show how many rooms a space would join when the user
enables auto-join for it. Spaces SHOULD NOT set `m.space.auto_join` when
their tree has more children than that.

### Existing implementation (Prinny)

Prinny, a Cinny fork, ships all three pieces under its own namespace:

- **Space event** `app.prinny.space.auto_join`, content `{ "auto_join": true }`,
  set from the space's settings by anyone with the power to send that state
  event. Only `auto_join === true` counts. There is no per-child form. (Prinny
  still writes `auto_join: false` into `m.space.child` content when creating
  or adding rooms, behaviour inherited from upstream Cinny; nothing reads it.)
- **Consent** `app.prinny.auto_join`, content `{ mode, spaces }` with modes
  `off`, `requested`, `all`. Settings label them "Off", "Spaces that ask",
  "All spaces"; each space's menu sets the per-space override ("Always", "Never",
  or "Default", which follows the mode). An unknown mode reads as `off`; malformed overrides are
  dropped. When the account has no event, Prinny falls back to an older
  per-device switch (default off): on means `all`, off means `off`. The first
  per-space write carries that fallback mode so other devices do not read
  `off`.
- **Left rooms** `app.prinny.left_rooms`, content `{ rooms: { roomId: ms } }`.
  Marked on every `join` → `leave` transition seen in sync, and written before
  the leave for leaves the user starts in Prinny (leave room, leave space with
  its rooms, `/leave`); unmarked if that leave fails, and on rejoin. Writes
  are serialised so concurrent leaves (a space and all its rooms) do not
  overwrite each other. Cap: 800 entries, newest kept; then, while the UTF-8
  JSON of `{ "rooms": ... }` is over 60,000 bytes, the newest 90 % are kept
  and the rest dropped, repeatedly. The code's measurements: 800 v12 room IDs
  come to about 48.8 KB, 800 legacy IDs on a 40-character server name about
  61.6 KB.
- **Joining** follows "What gets joined" above, with one addition: subspaces
  the user has pinned to the sidebar are neither joined nor descended into,
  leaving them to the user. Prinny does not yet enforce the 100-room limit
  from "Size".

## Potential issues

- **Bans.** A ban is membership `ban`, not `leave`, so a client following the
  rule above does not mark it. While banned the user cannot join anyway, but
  an unban sets membership to `leave` from `ban`, not from `join`, so the
  room is not marked and auto-join may rejoin it. Clients SHOULD also mark a
  room on a transition to `ban`. (Prinny does not do this today.)
- **Eviction forgets old leaves.** Once the list is full, the oldest leaves
  drop out and those rooms become eligible for auto-join again. 800 rooms is
  far more than most users leave, but heavy users of large public spaces can
  reach it.
- **Leaves made by clients that do not implement this** are still seen in
  sync by any client that does, as long as it is running and sees the
  `join` → `leave` transition. A client that comes back after a long gap, or
  starts from a fresh initial sync, may not see the transition (only the
  resulting `leave`), and then has nothing to mark. That window is closed
  only by every client writing the mark.
- **Bulk joins on first enable.** Turning on `all` for a user in many
  large spaces can produce hundreds of joins. The rate limit and the 100-room
  prompt bound this, but the user should be shown what will happen.
- **Federation load.** Each join is a federation join for rooms on other
  servers. This is the DoS concern MSC1772 raised; it is why the default is
  `off` and the space can only ask.

## Alternatives

- **MSC1772's per-child `auto_join` flag**, honoured unconditionally. Rejected
  for the reason in the normative rule: it lets room state make clients join.
- **`suggested` on `m.space.child`** (MSC1772) as the signal. `suggested`
  already means "show this prominently", which is different from "join it",
  and many spaces mark rooms suggested without wanting them joined.
- **Server-side auto-join** (the server joins the user when they join the
  space). That moves consent off the user's devices and cannot see per-user
  overrides or the left list without new server APIs. Some homeservers
  already offer server-wide auto-join rooms for new accounts, which is a
  different feature.
- **Per-device setting only** (Prinny's original form). The choice does not
  follow the user, so a phone and a desktop disagree, and a room left on one
  device is rejoined by the other. The account data form exists to fix that.
- **Store the left list as room tags.** Tags live in per-room account data
  for rooms the user has left; clients often stop tracking those rooms. One
  global event is easier to read in one place.

## Security considerations

- The normative rule above is the core of it: a space's state must not be
  able to cause joins. A malicious or compromised space moderator could
  otherwise add a child with `via` servers they control and make every
  member's homeserver contact them.
- Even under `requested` or `all`, joins go to `via` servers chosen by the
  sender of the `m.space.child` event. Users who enable auto-join accept that
  for the spaces they enabled it for; clients SHOULD make that clear in the
  setting's description.
- Auto-joining a room makes the user a visible member of it. Clients SHOULD
  NOT auto-join rooms whose join rule is not `public` or `restricted` to the
  space (an invite-only child will fail anyway).
- The left list is private account data, but it records rooms the user left
  and when. It reveals nothing to other users; the server already knows.

## Unstable prefix

| Stable | Unstable |
| --- | --- |
| `m.space.auto_join` (state event) | `app.prinny.space.auto_join` |
| `m.auto_join` (global account data) | `app.prinny.auto_join` |
| `m.auto_join.left_rooms` (global account data) | `app.prinny.left_rooms` |

The unstable content shapes are identical to the stable ones, so these are the
identifiers Prinny already reads and writes, and its users' data needs no
migration.

## Dependencies

- [MSC1772](https://github.com/matrix-org/matrix-spec-proposals/pull/1772)
  (merged): spaces, `m.space.child` and its `via`.
