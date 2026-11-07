# Proposal: Expiry for ephemeral profile fields

Draft. Not yet submitted as an MSC; the number is assigned on submission.

[MSC4133](https://github.com/matrix-org/matrix-spec-proposals/pull/4133)
(merged) lets users publish arbitrary key/value pairs in their global profile.
Several open proposals use it for state that is only true for a while:

- `m.status` and `m.call` in
  [MSC4426](https://github.com/matrix-org/matrix-spec-proposals/pull/4426)
  (user status, and "currently in a call").
- `m.rpc` in [MSC4320](https://github.com/matrix-org/matrix-spec-proposals/pull/4320)
  (rich presence: what the user is listening to or playing).

None of them can say when the value stops being true. The publisher is
expected to `DELETE` the field when the state ends. If the publisher never
gets to do that (the app crashes, the device loses power or network, the
process is killed by the OS), the field stays in the profile indefinitely.

The concrete case: a client publishes `m.call` when the user joins a call and
deletes it when they leave. If the app dies mid-call, `m.call` stays. Every
other user sees "In a call · 3 h 12 min" until the user happens to join and
leave another call from a client that deletes the field. A reader cannot tell
that stale field apart from a live call on another of the user's devices,
because both look identical.

This proposal adds one optional key, `expires_at`, to object-valued profile
fields. Readers stop showing the field once it has passed; publishers that are
still alive keep pushing it forward.

## Proposal

### The `expires_at` key

Any profile field whose value is a JSON object MAY contain the key
`expires_at`:

| Key | Type | Description |
| --- | --- | --- |
| `expires_at` | integer | Absolute Unix timestamp in **milliseconds**, by the publisher's clock, after which the field is stale. |

```json5
// GET /_matrix/client/v3/profile/@alice:example.org
{
  "displayname": "Alice",
  "m.call": {
    "call_joined_ts": 1770140640,      // seconds, as MSC4426 defines it
    "expires_at": 1770141240000        // milliseconds
  },
  "m.status": {
    "text": "On holiday",
    "emoji": "🌴",
    "expires_at": 1771200000000        // "clear my status on the 16th"
  },
  "m.rpc": {
    "type": "m.rpc.media",
    "artist": "ari melody",
    "album": "free2play",
    "track": "FTL (Faster Than Light)",
    "expires_at": 1770140940000
  }
}
```

Milliseconds are used to match `origin_server_ts` and the per-entry `expiry`
in [MSC4544](https://github.com/matrix-org/matrix-spec-proposals/pull/4544).
Note that MSC4426's `call_joined_ts` is in seconds; the two keys in one object
use different units, and implementations must not mix them up.

The key is generic: it is defined once here rather than in each field's MSC,
so a future field (an MSC4426 follow-up such as "what game is the user
playing") gets it without restating it. A field definition MAY forbid
`expires_at` if expiry makes no sense for it. Fields whose value is not an
object (for example `m.tz`, a string) cannot carry it and are out of scope.

A value that is not a non-negative finite integer MUST be ignored, which
means the field is treated as having no expiry.

### Readers

Let `grace` be a clock-skew allowance. This proposal RECOMMENDS 2 minutes.

- A client MUST NOT display a field as current once
  `now > expires_at + grace`, where `now` is the client's own clock.
- When it hides a field for that reason, the client SHOULD re-fetch the
  profile (`GET /_matrix/client/v3/profile/{userId}`), because the publisher
  may have written a successor value that the client has not seen.
- A client that is displaying a field with an `expires_at` SHOULD schedule
  that check for the moment the field expires, rather than waiting for its
  next unrelated refresh. Otherwise a crashed publisher's field stays visible
  until the reader happens to re-render.
- A field without `expires_at` behaves exactly as today.

The grace exists because `expires_at` is set by the publisher's clock and
checked against the reader's. Two clocks a minute apart would otherwise make a
live, regularly refreshed field flicker off on the reader whose clock runs
fast.

### Publishers

- A publisher that writes an ephemeral field SHOULD include `expires_at`.
- A publisher MAY keep the field alive by rewriting it with a later
  `expires_at` before the current one passes (a heartbeat). It SHOULD do so
  well inside the lifetime it chose, so that one failed or slow write does not
  make a live field lapse.
- The lifetime should be chosen with the reader's refresh and any server-side
  profile caching in mind (see Potential issues). A lifetime of a few minutes,
  refreshed every minute or so, is RECOMMENDED for automatically maintained
  fields such as `m.call` and `m.rpc`.
- A user-set field with a natural end, such as an `m.status` of "On holiday
  until Monday", MAY use a single far-future `expires_at` with no heartbeat.
- Publishers SHOULD still `DELETE` the field when the state ends. Expiry is
  the fallback for when that cannot happen, not a replacement for it.

### Servers

- Servers MUST store and serve `expires_at` like any other content of the
  field. They MUST NOT reject a field for containing it.
- A server MAY delete a field from a local user's profile once its
  `expires_at` has passed by the server's clock. It SHOULD NOT do so before
  `expires_at` plus a grace of its choosing, for the same skew reason as
  readers. A server that deletes an expired field SHOULD emit the removal to
  clients as it would a client-initiated `DELETE`; with
  [MSC4429](https://github.com/matrix-org/matrix-spec-proposals/pull/4429)
  that is a `null` value in `users.<user_id>.profile_updates`:

  ```json5
  {
    "users": {
      "@alice:example.org": {
        "profile_updates": { "m.call": null }
      }
    }
  }
  ```

- Server-side deletion is optional. Readers MUST apply the reader rules above
  whether or not the server deletes.

### Prior requests for this

- On MSC4320, Airyzz
  [suggested](https://github.com/matrix-org/matrix-spec-proposals/pull/4320#discussion_r2786807276):
  "Maybe including a timestamp `start_time` and `expire_time`, if a user goes
  offline without clearing their status, the `expire_time` could be used to
  not render the activity". TheArcaneBrony
  [replied](https://github.com/matrix-org/matrix-spec-proposals/pull/4320#discussion_r3064828103):
  "That is what Discord does".
- On MSC4426, clokep
  [asked](https://github.com/matrix-org/matrix-spec-proposals/pull/4426#discussion_r2860068690):
  "Additionally, was it considered to add an \"end time\" to the status?". The
  author, anoadragon453,
  [agreed](https://github.com/matrix-org/matrix-spec-proposals/pull/4426#discussion_r2860618553)
  that the MSC's wording prevents "please clear this status after I come back
  from holiday on 08/25" or "after 30m", and said the paragraph "needs to be
  rewritten or removed". A later reviewer, thomaschaaf,
  [asked](https://github.com/matrix-org/matrix-spec-proposals/pull/4426#discussion_r4486632104)
  for "a status expiration date/time" for the same holiday case. The current
  MSC4426 text (head `68316bb`) says the field may be set "by the homeserver to
  automatically clear the status after some time", but defines no expiry key.
- MSC4544, a competing rich-presence proposal, already gives every entry of
  its `m.rpc` array an `expiry` (absolute Unix ms) and says that after it
  passes clients "MUST stop displaying it and MUST re-fetch the profile to
  obtain any successor entry". This proposal brings the same mechanism to
  object-valued fields, MSC4320 and MSC4426 included.

### Existing implementation (Prinny)

Prinny, a Cinny fork, ships this for rich presence:

- **Writing.** The desktop app relays Discord-RPC activity from local apps.
  While an activity is live it writes the MSC4320 object to
  `com.ip-logger.msc4320.rpc` with `app.prinny.expires_at = now + 5 min`, and
  rewrites the unchanged activity every 60 s to push the expiry forward.
  Writes are coalesced to at most one per 5 s; a failed write backs off
  exponentially up to 5 min (so a long outage lets the field lapse, which is
  the intended result). When the activity ends, or the feature is turned off,
  it sends `DELETE`. The same object also carries
  `de.mreow.pinniped.expires_at` with the same value, the key another Cinny
  fork uses for the same purpose, so each fork hides the other's stale
  activity.
- **MSC4544.** In the same tick it also writes the MSC4544 array to
  `xyz.extera.msc4544.rpc` (one entry, a stable `id` per track or game, and
  `expiry` equal to the same timestamp), serialised after the MSC4320 write as
  MSC4544 asks, and deletes it (never an empty array) when the activity ends.
  It reads MSC4544 arrays too, skipping expired entries (cinny commit
  `879bd47`).
- **Reading.** A field with `app.prinny.expires_at` (or the other fork's key)
  past `expires_at + 2 min` is treated as absent. A timer fires at that moment
  and hides it even when no profile update arrives. Prinny does not re-fetch
  at that moment: profiles are re-fetched on a 3-minute heartbeat (and when a
  media track's end time is reached), and partial profile updates delivered
  through sync are merged in as they arrive. Re-fetching at expiry, as the
  reader rules above say, is a change Prinny still has to make.
- **Not yet covered.** Prinny publishes `org.matrix.msc4426.call` and
  `org.matrix.msc4426.status` without an expiry today, and reads them without
  one. The `m.call` problem described at the top of this proposal is therefore
  present in Prinny too; it is the next field this proposal is meant to fix.

## Potential issues

- **Clock skew larger than the grace.** A publisher whose clock is more than
  `grace` behind the reader's produces fields that look expired on arrival.
  The heartbeat cannot fix that. 2 minutes covers ordinary NTP-synced devices;
  badly wrong clocks will see their ephemeral fields hidden, which fails safe
  (nothing is shown) rather than showing stale data.
- **Profile caching.** MSC4133 lets servers cache remote profiles "for a short
  period of time". On MSC4320, TheArcaneBrony
  [raised](https://github.com/matrix-org/matrix-spec-proposals/pull/4320#discussion_r3064862554)
  servers and clients that "enforce long TTLs on profile caching", e.g. 15
  minutes. If a server caches a heartbeat-refreshed field for longer than its
  lifetime, readers get a cached copy whose `expires_at` has passed and hide a
  field that is still live. Servers that cache remote profiles SHOULD NOT
  serve a cached object-valued field past its `expires_at` without
  re-fetching it.
- **Traffic.** A heartbeat is a profile write, and each write may fan out over
  federation. MSC4426's "Performance" section already anticipates bursty
  writes to `m.call`. A 60 s refresh of a 5 min lifetime is one write per
  minute per active publisher. Publishers SHOULD NOT refresh more often than
  they need to, and servers MAY rate-limit writes that change only
  `expires_at`.
- **Readers that ignore the key** see today's behaviour: the field stays until
  deleted. Nothing breaks, nothing improves.
- **Unit mismatch** with MSC4426's `call_joined_ts` (seconds), noted above.

## Alternatives

- **Rely on `DELETE` alone.** This is the status quo, and it is what fails
  when the publisher dies.
- **A relative TTL** (`ttl_ms: 300000`). The reader would need to know when
  the value was written, which profile reads do not expose. An absolute time
  is self-contained.
- **Per-field expiry keys** defined separately in each MSC. Every field would
  reinvent the same rules, and readers would need per-field code. One generic
  key keeps the reader logic in one place.
- **Server-enforced expiry only**, via a new profile API parameter (for
  example `PUT .../profile/{userId}/{key}?expires_in=...`). It needs server
  support before anyone benefits, and it gives readers nothing to check
  against while servers lag. This proposal allows server deletion but does not
  depend on it.
- **Name the key `expiry`**, matching MSC4544's per-entry key. That is
  reasonable and would let one reader handle both; `expires_at` is used here
  because it reads unambiguously as an absolute time inside objects that
  already contain other timestamps. The SCT may prefer either.
- **Use presence (`m.presence`) instead.** Presence already times out, but it
  carries only a state and a status message, not structured fields, and
  presence is disabled on many large deployments.

## Security considerations

- `expires_at` is advisory display metadata, not access control. An expired
  field is still readable through the profile API until it is deleted. Users
  MUST NOT be told that an expired value is gone; clients that offer "clear
  status after..." SHOULD also delete the field at that time when they are
  running.
- A publisher can set an arbitrarily far-future `expires_at`. That is no worse
  than omitting the key.
- Readers MUST bound any timer they schedule from `expires_at`. In JavaScript,
  `setTimeout` with a delay above 2^31−1 ms fires immediately, so a hostile
  far-future value could otherwise cause a tight refresh loop. Prinny clamps
  the delay to that ceiling.
- The value reveals roughly when the publisher last wrote the field, which in
  turn hints at when the user was last active. That is already observable by
  watching profile updates.

## Unstable prefix

Until this proposal is accepted, implementations use
`app.prinny.expires_at` in place of `expires_at`, inside whatever key the
field itself currently uses:

| Stable | Unstable |
| --- | --- |
| `expires_at` inside any object-valued profile field | `app.prinny.expires_at` |

So an MSC4320 object in its unstable field reads:

```json5
{
  "com.ip-logger.msc4320.rpc": {
    "type": "com.ip-logger.msc4320.rpc.activity",
    "name": "SuperTuxKart",
    "app.prinny.expires_at": 1770140940000
  }
}
```

This is the key Prinny already writes and reads, so its users' data needs no
migration. Readers MAY also honour `de.mreow.pinniped.expires_at`, which an
independent fork writes with the same meaning. Readers SHOULD prefer
`expires_at`, then `app.prinny.expires_at`, when more than one is present.

## Dependencies

- [MSC4133](https://github.com/matrix-org/matrix-spec-proposals/pull/4133)
  (merged): the profile fields this key lives in.
- Fields that benefit, all open:
  [MSC4426](https://github.com/matrix-org/matrix-spec-proposals/pull/4426)
  (`m.status`, `m.call`),
  [MSC4320](https://github.com/matrix-org/matrix-spec-proposals/pull/4320)
  (`m.rpc`). This proposal does not depend on them being accepted; it applies
  to any object-valued field.
- [MSC4429](https://github.com/matrix-org/matrix-spec-proposals/pull/4429)
  (open), optional: how a server-side deletion reaches clients.
- Related: [MSC4544](https://github.com/matrix-org/matrix-spec-proposals/pull/4544)
  (open), whose per-entry `expiry` covers array-valued rich presence.
