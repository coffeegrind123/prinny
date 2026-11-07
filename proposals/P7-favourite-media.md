# Proposal: Favourite media in account data

Draft. Not yet submitted as an MSC; the number is assigned on submission.

Users of chat platforms keep a personal collection of GIFs, stickers and images they reuse. Matrix has
no portable place for that collection, so each client keeps its own, usually in local storage, and the
collection does not follow the user to another device or client. This proposal adds a global account
data event that lists a user's favourite media, in a vendor-neutral shape that any client can read and
write.

No other Matrix client is known to store favourite media in account data. A search on 2026-11-02, and a
spot check on 2026-11-07 of Element Web, FluffyChat and Nheko with `gh search code`, found favourites only
for rooms (`m.favourite` tags) and recently used emoji (MSC4356), not for media.

## Proposal

### The `m.favourite_media` account data event

A new global account data event type `m.favourite_media` is introduced. Its `content` has one
property:

- `favourites` (array of Favourite objects, required): the user's favourite media, ordered newest
  first.

A Favourite object has these properties:

| Property     | Type          | Required                  | Description |
| ------------ | ------------- | ------------------------- | ----------- |
| `id`         | string        | yes                       | Identifier of the entry, used for deduplication. See [Identity and deduplication](#identity-and-deduplication). |
| `added_at`   | integer       | yes                       | When the entry was added, in milliseconds since the Unix epoch. |
| `kind`       | string        | yes                       | `"mxc"` or `"url"`. |
| `body`       | string        | yes                       | A textual description of the media, used as alt text and as the `body` when the media is sent. |
| `mxc`        | string        | when `kind` is `"mxc"`    | The `mxc://` URI of the media. |
| `file`       | EncryptedFile | no, only for `"mxc"`      | The [`EncryptedFile`](https://spec.matrix.org/v1.19/client-server-api/#extensions-to-mroommessage-msgtypes) object needed to decrypt the media, for media that came from an encrypted room. |
| `url`        | string        | when `kind` is `"url"`    | An `https://` URL of the media file itself. |
| `page_url`   | string        | no, only for `"url"`      | An `https://` URL of a web page about the media, for example the GIF host's page for it. |
| `info`       | ImageInfo     | no                        | The [`ImageInfo`](https://spec.matrix.org/v1.19/client-server-api/#msticker_imageinfo) object as used by `m.image` and `m.sticker`. `mimetype` SHOULD be present. A `video/*` mimetype means the entry is a short looping video ("GIF as video"). |

Clients MUST NOT add properties holding provider-specific objects (for example a GIF API's response
item) to a Favourite. Clients MAY add namespaced properties using the
[Common Namespaced Identifier Grammar](https://spec.matrix.org/v1.19/appendices/#common-namespaced-identifier-grammar)
and MUST preserve properties they do not understand when rewriting an entry.

Example:

```json
{
  "type": "m.favourite_media",
  "content": {
    "favourites": [
      {
        "id": "mxc://example.org/AbCdEfGhIjKlMnOpQrStUvWx",
        "added_at": 1762500000000,
        "kind": "mxc",
        "mxc": "mxc://example.org/AbCdEfGhIjKlMnOpQrStUvWx",
        "body": "dancing-cat.gif",
        "info": {
          "mimetype": "image/gif",
          "size": 482113,
          "w": 320,
          "h": 240
        },
        "file": {
          "v": "v2",
          "url": "mxc://example.org/AbCdEfGhIjKlMnOpQrStUvWx",
          "key": {
            "alg": "A256CTR",
            "ext": true,
            "k": "qcHVMSgYg-71CauWBezXI5qkaRb0LuIy-Wx5kIaHMIA",
            "key_ops": ["encrypt", "decrypt"],
            "kty": "oct"
          },
          "iv": "X85+XgHN+HEAAAAAAAAAAA",
          "hashes": {
            "sha256": "7aOBQ3+o8nLQoNh5Z4j1y6Ye6NtMxQ0ZfN3Q0x2kq3s"
          }
        }
      },
      {
        "id": "https://media.example.com/abc123/clip.mp4",
        "added_at": 1762400000000,
        "kind": "url",
        "url": "https://media.example.com/abc123/clip.mp4",
        "page_url": "https://gifs.example.com/view/abc123",
        "body": "Cat dancing",
        "info": {
          "mimetype": "video/mp4",
          "w": 498,
          "h": 280
        }
      },
      {
        "id": "mxc://example.org/StickerMediaId",
        "added_at": 1762300000000,
        "kind": "mxc",
        "mxc": "mxc://example.org/StickerMediaId",
        "body": "thumbs up",
        "info": {
          "mimetype": "image/png",
          "w": 256,
          "h": 256
        }
      }
    ]
  }
}
```

### Validation

A client reading the event MUST ignore (but, when rewriting the list, SHOULD drop) any entry that:

- is not an object, or lacks a string `id`, an integer `added_at` or a string `body`;
- has a `kind` other than `"mxc"` or `"url"`;
- has `kind` `"mxc"` and an `mxc` that does not start with `mxc://`;
- has `kind` `"mxc"` and a `file` whose `url` differs from `mxc`;
- has `kind` `"url"` and a `url` that is not an `https://` URL.

A client MUST ignore a `page_url` that is not an `https://` URL.

Entries with an unknown `kind` are reserved for future extension. A client that does not recognise a
`kind` MUST NOT display the entry, and SHOULD preserve it when rewriting the list. This takes precedence
over the "SHOULD drop" above.

### Identity and deduplication

The `id` of an entry is:

- for `kind` `"mxc"`: the `mxc` URI;
- for `kind` `"url"`: the `url`.

A list MUST NOT contain two entries with the same `id`. When adding media whose `id` is already present,
a client MUST NOT add a second entry. It MAY move the existing entry to the front and update its
`added_at`. When reading a list that contains duplicate `id`s, a client MUST keep the first occurrence
and ignore the rest.

Two different `mxc` URIs can refer to identical bytes (for example the same GIF uploaded twice, or the
same file re-encrypted with a different key). This proposal does not deduplicate by content. Clients
MAY do so using `file.hashes.sha256` for encrypted media, but SHOULD NOT download media only to compare
it.

### Ordering

The `favourites` array is ordered newest first by the time each entry was added. A client adding an
entry MUST insert it at the start of the array. Clients MAY offer the user a way to reorder the list;
a client that does so writes the user's order to the array and MUST NOT re-sort a list by `added_at`
when reading it. `added_at` is informational after insertion.

### Size limit

Account data is written with `PUT /_matrix/client/v3/user/{userId}/account_data/{type}`. The
specification sets a 65536-byte limit on events, and image packs (MSC2545) already plan around it.
Whether a given homeserver enforces the same limit on account data is implementation-specific (see
[Potential issues](#potential-issues)). To stay portable:

- A client MUST NOT write content whose canonical JSON encoding exceeds 65536 bytes.
- A client SHOULD keep the encoded content under 60000 bytes, leaving room for entries added by other
  clients before the next sync.
- When adding an entry would exceed the client's limit, the client MUST either refuse the addition and
  tell the user, or remove entries from the end of the array (the oldest) until the content fits. It
  MUST NOT silently drop the entry being added.

As a guide, a plain `mxc` entry with `info` is about 230 bytes, a `url` entry about 260 bytes, and an
`mxc` entry with an `EncryptedFile` about 560 bytes. 60000 bytes therefore holds roughly 100 encrypted
or 250 unencrypted entries.

### Concurrent writes

Account data has no compare-and-swap. Two clients that read, modify and write the list at the same time
will lose one change. Clients SHOULD read the latest event content from their sync state immediately
before writing, and SHOULD serialise their own writes so that a second change waits for the first to
be echoed back in `/sync`.

### Rendering and sending

To display an `mxc` entry, a client downloads it through the authenticated media endpoints. If `file`
is present, the client MUST decrypt the downloaded bytes with `file` before displaying them, and MUST
verify `file.hashes.sha256`.

To send an entry into a room:

- An `mxc` entry without `file` sent into an unencrypted room MAY reuse the `mxc` URI directly.
- An `mxc` entry with `file` MAY be sent into an encrypted room reusing the same `file` object. Clients
  SHOULD NOT send it into an unencrypted room with the same `file`, since that publishes the key; they
  SHOULD decrypt and re-upload the plaintext instead.
- An `mxc` entry without `file` sent into an encrypted room SHOULD be downloaded, encrypted and
  re-uploaded, consistent with how the client treats any other upload into an encrypted room.
- A `url` entry MUST be downloaded by the client and uploaded to the homeserver (encrypted when the room
  is encrypted) before sending. A client MUST NOT send the third-party `url` as the media of an
  `m.image`, `m.video` or `m.sticker` event.

Whether to send as `m.image`, `m.video` or `m.sticker` is up to the client. A `video/*` `info.mimetype`
indicates the media is a looping video and SHOULD be sent as `m.video`.

### Unavailable media

An `mxc` URI may stop resolving (media deleted or quarantined by the server, remote server offline, or
retention purged it). A `url` may return an error or different content.

- A client that fails to load an entry MUST NOT remove it from the list automatically. The failure may
  be temporary, and removing it writes to account data for every device.
- A client SHOULD show an unavailable entry as such, and SHOULD let the user remove it.
- A client MAY remove an entry automatically only after a definitive answer: an `M_NOT_FOUND` error from
  the media repository for an `mxc` entry, or an HTTP 404 or 410 for a `url` entry, observed on more than
  one attempt.
- A client that fails to decrypt `file` or fails the hash check MUST NOT display the media and SHOULD
  treat the entry as unavailable.

### Stickers and image packs

Image packs ([MSC2545](https://github.com/matrix-org/matrix-spec-proposals/pull/2545), stable since
Matrix v1.19 as `m.room.image_pack` and `m.image_pack.rooms`) are curated, named sets of images with
shortcodes, published in room state so others can use them. Favourite media is different: a private,
unnamed, ordered list of individual pieces of media, usually collected from messages other people sent.

- Favourite media entries have no shortcode and are not usable as `:shortcode:` emoticons.
- A client MAY let the user favourite an individual sticker from an image pack. The resulting entry is
  an ordinary `mxc` entry. It does not reference the pack and does not change when the pack changes.
- Clients SHOULD NOT add favourite media to the image pack lists they present for `m.image_pack.rooms`
  or room packs. A client MAY show favourites in a separate section of its sticker or GIF picker.

### Migrating from `app.prinny.gif_favorites`

Prinny shipped an earlier format under `app.prinny.gif_favorites`. It is not in the proposed shape, so
the proposed event uses a new key (see [Unstable prefix](#unstable-prefix)) instead of reusing the old
one. The old content is:

```json
{
  "favorites": [
    {
      "id": "<provider id, mxc URI or video URL>",
      "addedAt": 1762500000000,
      "fav": { "kind": "klipy", "gif": { "id": "...", "title": "...", "media_formats": { "mp4": { "url": "...", "dims": [498, 280], "size": 123456 } }, "itemurl": "..." } }
    }
  ]
}
```

`fav` is one of three variants:

- `{"kind": "klipy", "gif": <object>}`: a whole result object from a Tenor-v2-shaped GIF API (Klipy,
  Tenor, or Giphy converted to that shape). Its `id` is the provider's GIF id, prefixed `giphy:` for
  Giphy.
- `{"kind": "mxc", "mxc", "body", "info"?, "encInfo"?, "video"?}`: media from a timeline event.
  `encInfo` is the event's `file` object.
- `{"kind": "url", "title", "videoUrl", "pageUrl"?}`: a video URL from a GIF provider.

An even older form, `{"id", "gif": <object>, "addedAt"}` with no `fav`, is read as the `klipy` variant.
Before account data, the list lived in the browser's `localStorage` under the key `gifFavorites`.

A client migrating SHOULD, once per account, when `app.prinny.gif_favorites` exists and the new event
does not:

1. Convert each old entry, keeping the array order:
   - `klipy`: `kind` `"url"`; `url` from the first present of `media_formats.mp4`, `tinymp4`,
     `mediumgif`, `tinygif` (the order Prinny uses when sending); `page_url` from `itemurl`; `body`
     from `title` (or `"GIF"` if empty); `info.mimetype` `"video/mp4"` for the MP4 formats and
     `"image/gif"` for the GIF formats; `info.w`, `info.h` from `dims`; `info.size` from `size`. The
     provider object is discarded.
   - `mxc`: `kind` `"mxc"`; `mxc`, `body`, `info` copied; `encInfo` becomes `file`. If `video` is true
     and `info.mimetype` is not `video/*`, set `info.mimetype` to `"video/mp4"`.
   - `url`: `kind` `"url"`; `url` from `videoUrl`; `page_url` from `pageUrl`; `body` from `title`;
     `info.mimetype` `"video/mp4"`.
   - `addedAt` becomes `added_at`. `id` is recomputed by the rules in
     [Identity and deduplication](#identity-and-deduplication), which changes it for the `klipy`
     variant from the provider id to the media URL.
2. Drop entries that fail [validation](#validation), and deduplicate by the new `id`.
3. Apply the [size limit](#size-limit).
4. Write the new event.
5. Leave `app.prinny.gif_favorites` in place, so older Prinny versions keep working, until the client
   no longer supports them. It MAY then be cleared by writing `{}` to it.

After migration the client reads and writes only the new event. It MUST NOT write the old event again,
since a later re-migration would then resurrect deleted favourites. Because the stored provider URLs were
issued by the provider, they may stop resolving at any time; migrated `klipy` entries are subject to
[Unavailable media](#unavailable-media) like any `url` entry.

## Potential issues

**Size.** A single account data event caps the collection at roughly 100 to 250 entries depending on the
mix. Users who collect more will hit the limit. The specification's 65536-byte limit is stated for
events; account data is not a PDU. In Synapse's `PUT .../account_data/{type}` handler
(`synapse/rest/client/account_data.py`) there is no account-data-specific size check, only the
listener's general request body limit. Other homeservers were not checked. The 65536-byte rule in this
proposal is a portability floor, not a description of every server.

**Lost updates.** Concurrent writes from two devices lose one change (see [Concurrent writes](#concurrent-writes)).
This is a general property of account data. Lists are short and writes are user-initiated, so collisions
should be rare.

**Media lifetime.** Favourites refer to media the user does not own. A homeserver's media retention
policy, or the uploader deleting the media, can make an entry unavailable with no notice. Clients that
want to guarantee availability can re-upload the media to the user's own homeserver when it is
favourited, at the cost of storage; this proposal permits it (the entry then holds the new `mxc`) but
does not require it.

**`url` entry lifetime.** Third-party GIF hosts can change or revoke media URLs. Whether Klipy's or
Tenor's media URLs are stable long-term was not verified for this draft.

**Large initial sync.** Account data is sent in full on initial sync. A 60 KB event adds 60 KB to every
initial sync of every client, including clients that do not implement this proposal.

## Alternatives

**An image pack.** The favourites could be written as an MSC2545 image pack. Stable MSC2545 defines only
room packs (`m.room.image_pack` state events) and references to them (`m.image_pack.rooms`). The personal
account data pack that clients use (`im.ponies.user_emotes`) is not part of the merged MSC or the v1.19
specification. A room pack would need a dedicated room per user, would be readable by anyone in that room,
requires shortcodes, and has no field for an `EncryptedFile`, so media from encrypted rooms could not be
favourited without re-uploading it unencrypted.

**Storing provider objects.** Prinny's first format stored whole GIF API result objects. That ties the
data to one provider's schema, carries fields no other client understands, and is larger than needed.
The proposed shape records only what is needed to render and send.

**One event per favourite** (for example `m.favourite_media.<id>`). This removes the size limit and the
lost-update problem, but account data has no listing by prefix, so clients would have to scan all account
data on every sync. It also multiplies the number of account data events per user.

**Room account data or a dedicated room.** A private room holding one message per favourite would remove
the size limit and could be end-to-end encrypted, but it needs a room per user, and clients must paginate
that room to show the collection. This could be revisited if collections routinely exceed the limit.

**Folding in generated emoticons.** See the companion proposal "Generated emoticon cache", which
discusses combining both lists into one "personal media collections" event and recommends against it.

## Security considerations

**Encryption keys in account data.** An entry for media from an encrypted room holds that media's
`EncryptedFile`, including the AES key. Account data is not end-to-end encrypted. Storing the entry
discloses the key to the user's homeserver, which already holds the ciphertext, and so lets the server
operator decrypt that piece of media. The media is otherwise protected only by the room's encryption.

- Clients MUST tell the user, before the first favourite from an encrypted room is stored, that doing so
  makes that media readable by their homeserver; or MUST encrypt the event as below.
- [MSC4483](https://github.com/matrix-org/matrix-spec-proposals/pull/4483) (Encrypted Account Data, open)
  defines an account data key kept in secret storage and an `{"encrypted": {"iv", "ciphertext", "mac"}}`
  content form using `m.secret_storage.v1.aes-hmac-sha2`. It requires that specified account data be
  listed as encryptable before clients encrypt it. This proposal lists `m.favourite_media` as
  encryptable under MSC4483. Clients that implement MSC4483 SHOULD encrypt this event, and MUST encrypt it
  if it contains any entry with `file`. A client that cannot decrypt an encrypted `m.favourite_media`
  MUST NOT overwrite it.
- Until MSC4483 is accepted, its unstable key name `dev.zirco.msc4483.account_data.key` applies.

**What the list reveals.** Even without keys, the list shows the server which media the user cares about
and when they added it. Encrypting under MSC4483 hides this too.

**Third-party URLs leak the viewer's IP address.** Rendering a `url` entry fetches it from a third party
directly from the user's device. That host learns the user's IP address, user agent and the time each
time the favourites are displayed, and can correlate this over time. A favourites list can be written by
any of the user's clients, so a compromised or careless client can add `url` entries that point at a
tracking host.

- Clients SHOULD NOT fetch `url` entries until the user opens the favourites view, and SHOULD NOT
  prefetch them in the background.
- Clients MAY fetch `url` entries through a proxy, or MAY ask the user before loading third-party media.
- Clients MUST NOT send cookies or credentials with these requests, and SHOULD send no `Referer`.
- When sending a `url` entry, the client re-uploads it (see [Rendering and sending](#rendering-and-sending)),
  so recipients do not fetch from the third party.

**Untrusted content.** Media in `url` entries comes from outside Matrix. Clients MUST apply the same
content handling (MIME sniffing restrictions, size limits, sandboxing of decoders) they apply to any
remote media, and MUST reject `url` and `page_url` values that are not `https://`.

## Unstable prefix

| Stable identifier          | Unstable identifier            |
| -------------------------- | ------------------------------ |
| `m.favourite_media` (account data event type) | `app.prinny.media_favorites` |

The unstable name is a new key, not Prinny's shipped `app.prinny.gif_favorites`. The shipped event's
content is not in the proposed shape (it holds whole provider objects and a different entry layout), so
reusing its key would make every existing Prinny install write content that conforms to neither format.
Clients migrate from the old key as described in [Migrating from `app.prinny.gif_favorites`](#migrating-from-appprinnygif_favorites).

Property names inside the content are unprefixed while unstable, since they live inside an
unstable-named event.

## Dependencies

None required. Encryption of the event uses
[MSC4483](https://github.com/matrix-org/matrix-spec-proposals/pull/4483) where available; this proposal
does not block on it, but relies on it for the strongest form of its security considerations.
