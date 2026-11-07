# Proposal: Per-user order of rooms within a space

Draft. Not yet submitted as an MSC; the number is assigned on submission.

[MSC1772](https://github.com/matrix-org/matrix-spec-proposals/pull/1772)
(merged) orders a space's children with the `order` key of `m.space.child`
state events. That order is part of the space's state: it is the same for
every member, and changing it needs the power level to send
`m.space.child`. An ordinary member cannot put the three rooms they actually
use at the top of a 40-room space.

[MSC3230](https://github.com/matrix-org/matrix-spec-proposals/pull/3230)
(open) gives users their own order for top-level spaces, stored in room
account data on each space. It says explicitly that it "only concerns top
level space ordering as subspace ordering is defined in the space as per
m.space.child event".

This proposal fills that gap: a per-user, cross-device order of the rooms
inside a space, stored in room account data on the parent space, in the same
spirit as MSC3230.

## Proposal

### Event

A new room account data event type, `m.space_child_order`, set by a user on a
space room (`PUT /_matrix/client/v3/user/{userId}/rooms/{spaceId}/account_data/m.space_child_order`):

```json5
{
  "type": "m.space_child_order",
  "content": {
    "mode": "custom",
    "order": [
      "!announcements:example.org",
      "!general:example.org",
      "!offtopic:example.org"
    ]
  }
}
```

| Key | Type | Description |
| --- | --- | --- |
| `mode` | `"default"` or `"custom"` | Optional. `default` (or absent) means the client uses the space's shared order from `m.space.child`. `custom` means it uses `order`. |
| `order` | array of room IDs | Optional. The user's order of this space's child rooms, first to last. |

Rules:

- `mode` values other than `default` and `custom` MUST be treated as
  `default`. This keeps a future mode, or an older client's leftover value,
  from producing an order the reader does not understand.
- `order` entries that are not strings, or not room IDs, MUST be ignored.
  Duplicate entries: the first occurrence wins.
- The event applies to the space's direct children only. A subspace's
  children are ordered by the event on that subspace. This mirrors how
  `m.space.child` works: each space orders its own children.
- Subspaces themselves (children whose room type is `m.space`) are not
  ordered by `order`. Clients order them by `m.space.child` `order` as
  MSC1772 says. A later proposal could extend `order` to them.

### Reading

While `mode` is `custom`:

1. Children that appear in `order` come first, in that order.
2. Children that do not appear in `order` (rooms added to the space after the
   user last reordered, or never placed) come after all listed ones. Their
   relative order is the client's choice; clients SHOULD use a stable,
   meaningful order such as most recent activity first.
3. Entries in `order` that are no longer children of the space, or that the
   client cannot show (the user left the room, the `m.space.child` event was
   removed or has no valid `via`), MUST be skipped. They MUST NOT be shown as
   placeholders.
4. If `mode` is `custom` but `order` is absent, every child falls under rule 2.

While `mode` is `default` or absent, `order` MUST be ignored and the shared
MSC1772 order applies. Keeping `order` around while in `default` mode lets a
user switch back to `custom` and get their arrangement back.

### Writing

- When the user moves a room, the client writes the full new `order` for that
  space's section in one `PUT`, and sets `mode` to `custom` in the same
  write. Two separate writes would race: each would start from the same old
  content and the second would drop the first's change.
- Clients SHOULD write `order` from the children they currently show in the
  section, which drops entries for rooms that have since gone. That keeps the
  list from growing without bound.
- Clients SHOULD serialise writes per space and compose each from the content
  as it stands when the write runs (after the previous write's sync echo),
  so queued reorders do not overwrite each other.
- A client MUST NOT write `m.space.child` `order` on the user's behalf when
  the user is in `custom` mode. A drag in `custom` mode is a personal change.
  In `default` mode, a client MAY offer to edit the shared order instead,
  if the user has the power level for `m.space.child`.

### Existing implementation (Prinny) and migration

Prinny, a Cinny fork, ships this today in a different shape: a single
**global** account data event, `app.prinny.room_order`:

```json5
{
  "type": "app.prinny.room_order",
  "content": {
    // keyed by the ROOT space the nav is showing
    "sortModes": { "!root:example.org": "custom" },
    // keyed by each PARENT space, root or subspace
    "orders": {
      "!root:example.org": ["!a:example.org", "!b:example.org"],
      "!sub:example.org": ["!c:example.org", "!d:example.org"]
    }
  }
}
```

What the code does today:

- The sort mode is chosen per root space and applies to every section shown
  under it, including subspace sections. The order is stored per parent
  space.
- Stored modes `alpha` and `activity` (left by an older version) are read as
  `default`.
- In `custom` mode, rooms listed for a parent come first in list order;
  unlisted rooms follow, most recently active first. A parent with no list
  yet is ordered entirely by activity, not by `m.space.child` `order`.
- Listed rooms that are no longer shown are skipped. A drag rewrites that
  section's list from the rooms the section currently shows, which drops
  them.
- A drag writes the new list and switches the root to `custom` in one write.
  Writes go through a queue, and each composes from the account data as it
  stands when it runs.
- In `default` mode, a drag instead rewrites `m.space.child` `order` keys
  (shared, needs power), and is refused without the power level.
- Sections the user has collapsed are sorted by activity regardless of mode.

The global event has the problem MSC3230 gives for rejecting a global array:
it "won't scale, could reach event content size limit". Every space's orders
share one event. This proposal moves each list onto its own space.

**Migration**, for a client that has the global event:

1. On start, if a space has no `m.space_child_order` (stable or unstable) but
   the global `app.prinny.room_order` has an entry for it, read the entry.
2. Write the per-space event: `order` from `orders[spaceId]`; `mode` from
   `sortModes[spaceId]` if present. For a subspace that has an `orders` entry
   but no `sortModes` entry, use `custom` if any root space containing it has
   `sortModes` set to `custom` (that is how the entry got written), else
   `default`.
3. For one release, write both the per-space event and the global event on
   every change, so older versions of the client on the user's other devices
   keep working. Read the per-space event first and fall back to the global
   one.
4. After that release, stop writing the global event. It may be left in
   place; it is ignored.

The behaviour change in step 2 is deliberate: in the per-space model each
subspace has its own `mode`, where Prinny today applies the root's mode to
all of them.

## Potential issues

- **One event per space.** A user in many spaces has many small events
  rather than one large one. That is the point (each stays far below any
  size limit), but initial sync carries all of them. Room account data is
  already per room, so this adds one event to rooms that are spaces.
- **Order strings versus a list.** MSC3230 uses one `order` string per item,
  so a move rewrites one item. This proposal rewrites the whole list for one
  space on each move. For a space's children that is one write of a few
  kilobytes at most, and it is atomic for the section, which MSC3230 notes
  its own scheme is not: "Spreading the order information across all spaces
  account data is making order changes not atomic."
- **Large spaces.** A space with thousands of children produces a list of
  thousands of room IDs. The spec sets no size limit on account data;
  implementations do. Clients SHOULD write only rooms the user has placed or
  that sit above a placed room, not every child.
- **Unjoined children.** A space may list rooms the user has not joined.
  Clients that show those rooms (for example in a space lobby) MAY include
  them in `order`; readers handle unknown IDs by rule 3.

## Alternatives

- **Write `m.space.child` `order`.** Shared and power-gated; this is the
  thing users cannot do.
- **Room tags (`m.tag`) with `order`.** Tags are per room, not per (space,
  room) pair, so a room in two spaces could have only one position. Tags
  also already carry meaning (favourites, low priority). MSC3230 rejected
  tags for similar reasons.
- **One global event** (Prinny's current format, and MSC3230's discarded
  alternative). Size grows with the number of spaces.
- **Extend MSC3230's `m.space_order`** with a `children` key. Workable, but
  it mixes "where this space sits among my spaces" with "how I order this
  space's rooms", and MSC3230 would have to change. A separate type lets
  either proceed alone.
- **[MSC3872](https://github.com/matrix-org/matrix-spec-proposals/pull/3872)**
  (open) proposes a manual order set by space administrators. That is a
  shared order, like MSC1772's; it complements this proposal rather than
  replacing it.

## Security considerations

Room account data is private to the user. Other members, and the space's
administrators, cannot see the user's order. The server sees which rooms the
user cares about most, which it can largely infer from activity already.

Readers MUST NOT join, peek or preview rooms because they appear in `order`;
the list only sorts children the client already knows about from the
space's state.

## Unstable prefix

| Stable | Unstable |
| --- | --- |
| `m.space_child_order` (room account data on the space) | `app.prinny.room_order` (room account data on the space) |

The unstable type reuses the name of Prinny's existing global event, now in
room scope. Global and room account data are separate namespaces in the
Client-Server API, so the two do not collide, and readers can tell them apart
by where they arrive (`account_data` versus `rooms.join.<id>.account_data`).
The global event is migrated as described above.

## Dependencies

- [MSC1772](https://github.com/matrix-org/matrix-spec-proposals/pull/1772)
  (merged): spaces and `m.space.child`.
- Related, not required:
  [MSC3230](https://github.com/matrix-org/matrix-spec-proposals/pull/3230)
  (open), the top-level counterpart this mirrors.
