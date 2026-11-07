# Proposal: Generated emoticon cache in account data

Draft. Not yet submitted as an MSC; the number is assigned on submission.

Some clients offer emoticons that are generated on demand from a small set of inputs instead of being
chosen from a curated pack. The motivating case is Google's Emoji Kitchen, which publishes artwork for
about 147,000 pairs of 619 Unicode emoji: the user picks two emoji and gets one combined image. To use
such an image in a reaction or inline in a message, the client has to upload it, because a recipient
cannot be expected to fetch it from the generator. Without shared state, every device uploads the same
image again, producing a new `mxc://` URI each time.

This proposal adds a global account data event that records, per user, which generated emoticons have
been uploaded and where. It is both a cache (the same inputs map to the same `mxc://` URI on every device
of the user) and a recency list (the client can offer recently used generated emoticons first).

## Proposal

### The `m.generated_emoticons` account data event

A new global account data event type `m.generated_emoticons` is introduced. Its `content` has one
property:

- `emoticons` (array of Generated Emoticon objects, required): ordered most recently used first.

A Generated Emoticon object has these properties:

| Property    | Type             | Required | Description |
| ----------- | ---------------- | -------- | ----------- |
| `generator` | string           | yes      | Identifier of the generator, a [Common Namespaced Identifier](https://spec.matrix.org/v1.19/appendices/#common-namespaced-identifier-grammar). See [Generators](#generators). |
| `inputs`    | array of strings | yes      | The generator's inputs in the generator's canonical form. Together with `generator`, this is the cache key. |
| `mxc`       | string           | yes      | The `mxc://` URI of the uploaded image. |
| `shortcode` | string           | yes      | A shortcode following the [MSC2545 shortcode grammar](https://spec.matrix.org/v1.19/client-server-api/#image-packs) (`[a-zA-Z0-9-_]+`, at most 100 bytes). |
| `body`      | string           | yes      | Textual description, used as alt text and as the image `body`. |
| `info`      | ImageInfo        | no       | The [`ImageInfo`](https://spec.matrix.org/v1.19/client-server-api/#msticker_imageinfo) of the upload. `w`, `h` and `mimetype` SHOULD be present. |
| `revision`  | string           | no       | Generator-specific identifier of the artwork version the upload was made from. Informational. |
| `used_at`   | integer          | yes      | Last time the user used the emoticon, in milliseconds since the Unix epoch. |

Example:

```json
{
  "type": "m.generated_emoticons",
  "content": {
    "emoticons": [
      {
        "generator": "com.google.emoji_kitchen",
        "inputs": ["1f60d", "1f62d"],
        "mxc": "mxc://example.org/KitchenUploadA",
        "shortcode": "mash_heart_eyes__sob",
        "body": "😍 + 😭",
        "info": { "mimetype": "image/png", "size": 21344, "w": 534, "h": 534 },
        "revision": "20201001",
        "used_at": 1762500000000
      },
      {
        "generator": "com.google.emoji_kitchen",
        "inputs": ["1f382", "1f639"],
        "mxc": "mxc://example.org/KitchenUploadB",
        "shortcode": "mash_joy_cat__birthday",
        "body": "😹 + 🎂",
        "info": { "mimetype": "image/png", "size": 18760, "w": 534, "h": 534 },
        "used_at": 1762400000000
      }
    ]
  }
}
```

### Generators

A generator is a deterministic function from `inputs` to an image. Its identifier names both the
function and the canonical form of its inputs. Two clients that use the same `generator` MUST produce
the same `inputs` array for the same user choice, so that one client's cached upload is found by the
other.

Each generator identifier is defined by whoever introduces it, using the Common Namespaced Identifier
grammar. This proposal defines one:

**`com.google.emoji_kitchen`**

- `inputs` has exactly two elements, each a Unicode emoji written as lowercase hexadecimal code points
  joined with `-` (for example `"2639-fe0f"`), with no `u` prefix.
- The two elements are sorted in ascending order by plain string comparison. Emoji Kitchen draws one
  picture per unordered pair, so pick order MUST NOT affect `inputs`.
- `revision`, when present, is the date component of the Emoji Kitchen asset URL the image was fetched
  from (for example `"20201001"`).
- The suggested `shortcode` is `mash_<a>__<b>`, where `<a>` and `<b>` are the two emoji's shortcodes
  reduced to `[a-z0-9]` runs joined by single underscores, in `inputs` order. The double underscore is
  unambiguous because neither half can contain one. Clients MAY use another shortcode; the cache key is
  `generator` plus `inputs`, not the shortcode.

A client that does not recognise a `generator` MUST NOT discard entries using it. It MAY still display
and send such entries, since the stored `mxc`, `shortcode`, `body` and `info` are enough to do so.

### Cache behaviour

When the user picks a generated emoticon, the client:

1. Computes `generator` and canonical `inputs`.
2. Looks for an entry with equal `generator` and an `inputs` array equal element by element.
3. If one exists, it MUST use the stored `mxc` instead of uploading again, and SHOULD move the entry to
   the front with an updated `used_at`. It does not need to wait for that write before sending.
4. Otherwise it generates or fetches the image, uploads it **unencrypted** (see
   [Security considerations](#security-considerations)), and inserts a new entry at the front.

The list MUST NOT contain two entries with the same `generator` and `inputs`. A reader that finds
duplicates MUST use the first and ignore the rest.

If the stored `mxc` turns out to be unavailable (`M_NOT_FOUND` from the media repository), the client
SHOULD upload again and replace the entry's `mxc`. It MUST NOT keep using a URI it knows is gone.

### Ordering and size

The array is ordered by most recent use, newest first. Clients SHOULD cap the list. When adding an entry
would exceed the cap, the client removes entries from the end. Evicting an entry is harmless: the next use
of those inputs uploads again.

- Clients SHOULD keep at most 64 entries. (Prinny caps at 64.)
- Clients MUST NOT write content whose canonical JSON exceeds 65536 bytes. At about 300 bytes per entry,
  64 entries is roughly 20 KB.

### Presentation as an image pack

Clients MAY present the list to the user as a virtual image pack: one image per entry, keyed by
`shortcode`, with `url`, `body` and `info` taken from the entry and `usage` `["emoticon"]`. The pack
exists only in the client. It is not written to any room state or other account data, and its identifier
MUST NOT collide with real pack identifiers (room IDs, state keys).

This is what Prinny does (`useMashupImagePack`): it builds an in-memory `ImagePack` named "Mashups", and
inserts it into the list of packs the emoji board, `:` autocomplete and search index use. Entries whose
shortcode is already in the user's personal emote pack (`im.ponies.user_emotes`, see below) are omitted
from the virtual pack, so a shortcode is not shown twice.

A user may want to keep a generated emoticon permanently or make it available in other clients. A client
MAY offer to copy an entry into a real image pack. Prinny copies it into `im.ponies.user_emotes`.
Stable MSC2545 (Matrix v1.19) does not define a personal account data pack; only `m.room.image_pack`
state events and the `m.image_pack.rooms` account data event are stable. `im.ponies.user_emotes` is a
de facto unstable event that several clients read. Copying into a room pack is the stable alternative.

### Sending

Generated emoticons are sent like any custom emoticon from an image pack:

- inline, as an `<img data-mx-emoticon>` in `formatted_body` per MSC2545;
- as a reaction whose key is the `mxc` URI, per
  [MSC4027](https://github.com/matrix-org/matrix-spec-proposals/pull/4027) (open), with the entry's
  `shortcode` in the reaction content's `shortcode` field (unstable: `com.beeper.reaction.shortcode`,
  per MSC4027's unstable prefix section). Clients SHOULD read both names.

The entry's `mxc` MAY also be recorded as an `emoji` value in `m.recent_emoji`
([MSC4356](https://github.com/matrix-org/matrix-spec-proposals/pull/4356), merged), which explicitly allows
`mxc://` URIs. MSC4356 tracks usage counts but cannot map inputs to an upload, so it does not replace
this event.

### Migrating from `app.prinny.emoji_mashups`

Prinny shipped an Emoji Kitchen-only form of this event as `app.prinny.emoji_mashups`:

```json
{
  "mashups": [
    {
      "shortcode": "mash_heart_eyes__sob",
      "left": "1f60d",
      "right": "1f62d",
      "mxc": "mxc://example.org/KitchenUploadA",
      "body": "😍 + 😭",
      "info": { "mimetype": "image/png", "size": 21344, "w": 534, "h": 534 },
      "usedAt": 1762500000000
    }
  ]
}
```

Older entries may carry `face` and `mouth` instead of `left` and `right`, written by an earlier mashup
engine; Prinny reads them as `left` and `right`. In the shipped data, `left` and `right` are in the order
the user picked them, not sorted.

A client migrating SHOULD, once per account, when the old event exists and the new one does not:

1. Convert each entry: `generator` `"com.google.emoji_kitchen"`; `inputs` is `[left, right]` (or
   `[face, mouth]`) sorted as defined above; `shortcode`, `mxc`, `body`, `info` copied; `usedAt` becomes
   `used_at` (0 if absent).
2. Drop entries with an `mxc` that does not start with `mxc://`, keep array order, and deduplicate by
   cache key.
3. Write the new event, and leave the old one in place for older Prinny versions.

After migration the client reads and writes only the new event.

## Potential issues

**The cache is per user, not global.** Two users who pick the same inputs still upload separately and get
different `mxc` URIs. Reactions in Matrix are grouped by exact `key`, so their reactions appear as two
separate chips. MSC4027 acknowledges that different MXC URIs can refer to identical files. Prinny works
around it when sending: if an image reaction with the same `shortcode` is already on the event, it reacts
with that reaction's key instead of its own (`matchingReactionKey` in `src/app/utils/room.ts`). That only
works when both clients use the same shortcode, which is why this proposal gives a canonical shortcode
for `com.google.emoji_kitchen`. A shared cache across users (for example a deterministic media ID per
generator and inputs) would need server support and is out of scope.

**Shortcode collisions.** A generated shortcode can collide with a shortcode in a real image pack. The
virtual pack is a separate pack, so MSC2545's pack-qualified form (`:shortcode/pack:`) disambiguates.

**Canonical form drift.** If two clients disagree on the canonical `inputs` for a generator (for example
one includes emoji presentation selectors `fe0f` and the other does not), they miss each other's cache
entries and upload duplicates. Nothing breaks, but the cache stops saving uploads. Generator definitions
need to be exact about input normalisation. Prinny orders the two halves of its shortcode by position in
its bundled index table, which is sorted by code point string, so its shortcodes follow the canonical
order above; its stored `left`/`right` fields do not (they keep pick order).

**Generator artwork changes.** Emoji Kitchen asset URLs carry a date component, so artwork for a pair
can be published again under a newer date (whether Google has revised existing pairs this way was not
verified for this draft). A cached upload keeps the old artwork until it is evicted. `revision` lets a client detect this and
re-upload if it wants to; this proposal does not require it.

**Lost updates.** Account data has no compare-and-swap. Concurrent writes from two devices can lose an
entry, which costs one re-upload.

## Alternatives

**Write generated emoticons straight into an image pack.** The cache could be the user's personal emote
pack. Image packs are curated, other clients read them, and their order is not defined by MSC2545; a pack
that fills itself with every combination the user ever tried, and reorders on each use, would make that
pack unusable for its normal purpose. Prinny keeps the two separate and lets the user copy an entry into
the real pack.

**Local storage only.** Each device uploads its own copy. This is what the cache exists to avoid: wasted
uploads and, more visibly, split reaction chips between the user's own devices.

**Use `m.recent_emoji` (MSC4356).** It records `mxc` URIs and usage counts, but not which inputs produced
an upload, so a second device cannot find the existing upload for a given pair. It could be extended with
optional fields, but MSC4356 is merged and its entries are meant to be usable by clients that know nothing
about generators.

**Mashup-specific event.** The shipped `app.prinny.emoji_mashups` hard-codes two inputs called `left` and
`right`. Generating from other sources (other emoji combiners, text-to-emote renderers, recoloured
variants of pack emotes) would need a new event per generator. A `generator` plus `inputs` key covers them
all at the cost of one indirection.

**Fold this event and favourite media into one "personal media collections" event.** The companion
proposal "Favourite media in account data" also stores a user's personal media list in account data. A
single event with typed sections, for example
`{"favourites": [...], "generated": [...]}`, would mean one fetch and one place for future collections.

Recommendation: keep them separate. Reasons:

- Write frequency differs. The generated cache is rewritten on every use to update recency; favourites
  change only when the user adds or removes one. In one event, every emoticon use rewrites the favourites
  too, multiplying lost-update risk for the list that the user curates by hand.
- Size budgets differ. Favourites can fill most of the 65536-byte limit by design; the generated cache is
  a small bounded cache. Sharing one event means a full favourites list evicts the cache or blocks it.
- Encryption needs differ. Favourites can hold media keys and SHOULD be encrypted with MSC4483; the
  generated cache holds only unencrypted public uploads and does not need it. Encrypting both together
  would make the cache unreadable to clients without secret storage access for no benefit.
- Eviction semantics differ: dropping a cache entry is harmless, dropping a favourite loses user data.

The cost of separation is one extra account data event per user, which is small.

## Security considerations

**Uploads are unencrypted.** A reaction key is a plain string with nowhere to put an `EncryptedFile`,
and MSC2545 image pack images are unencrypted for the same reason. Generated emoticon uploads therefore
MUST be unencrypted, even when used in encrypted rooms. The image content is not private (for Emoji
Kitchen it is a picture Google publishes at a public URL), but the homeserver can see which uploads a
user makes and, by watching media requests, correlate their use with encrypted events. MSC2545 discusses
the same traffic-analysis concern for pack emotes. Clients SHOULD tell users that custom emoticons are
visible to their homeserver, as MSC2545 recommends.

**Fetching from the generator.** Generators that are remote services see the user's IP address and the
inputs they choose. For Emoji Kitchen, the client fetches artwork from `www.gstatic.com`, both for
previews in the picker and for the upload. Recipients only fetch the `mxc` from Matrix media, never from
the generator. Clients SHOULD NOT fetch from a generator before the user opens the generator's picker.

**What the list reveals.** The event shows the homeserver which emoticons the user uses and when.
Clients MAY encrypt it with [MSC4483](https://github.com/matrix-org/matrix-spec-proposals/pull/4483)
(open); this proposal lists `m.generated_emoticons` as encryptable under it. The entries carry no keys,
so encryption is optional.

**Untrusted entries.** Any of the user's clients can write the event. A client MUST validate entries
(`mxc` starts with `mxc://`, `shortcode` matches the grammar, `inputs` is an array of strings) and ignore
invalid ones, and MUST NOT fetch anything other than the `mxc` through the media repository when rendering
an entry. The `generator` and `inputs` are used only for cache lookup, never to construct a URL to fetch
for display.

## Unstable prefix

| Stable identifier | Unstable identifier |
| ----------------- | ------------------- |
| `m.generated_emoticons` (account data event type) | `app.prinny.generated_emoticons` |
| `com.google.emoji_kitchen` (generator identifier) | unchanged; it is already namespaced |

The unstable name is a new key, not Prinny's shipped `app.prinny.emoji_mashups`. Shipped Prinny parses
each entry into a fixed set of fields and rewrites the whole list on every use. An entry written in the
new shape under the old key would lose its `generator` and `inputs` on the next write by an older Prinny,
and an entry from another generator, which has no `left` and `right`, would be dropped. Clients migrate as
described in [Migrating from `app.prinny.emoji_mashups`](#migrating-from-appprinnyemoji_mashups).

## Dependencies

None required. Reactions with generated emoticons rely on
[MSC4027](https://github.com/matrix-org/matrix-spec-proposals/pull/4027) (open). Inline use relies on MSC2545, which is stable.
