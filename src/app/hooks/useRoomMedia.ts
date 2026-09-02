import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  EventTimeline,
  EventTimelineSetHandlerMap,
  MatrixEvent,
  MatrixEventEvent,
  MatrixEventHandlerMap,
  MsgType,
  Room,
  RoomEvent,
  RoomEventHandlerMap,
} from 'matrix-js-sdk';
import { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import { useMatrixClient } from './useMatrixClient';
import { MessageEvent } from '../../types/matrix/room';
import {
  IEncryptedFile,
  IImageInfo,
  IThumbnailContent,
  IVideoInfo,
  MATRIX_BLUR_HASH_PROPERTY_NAME,
  MATRIX_GIF_PROPERTY_NAME,
  MATRIX_SPOILER_PROPERTY_NAME,
  MATRIX_SPOILER_REASON_PROPERTY_NAME,
  IGalleryItem,
  isGalleryMsgType,
} from '../../types/matrix/common';
import { getBlobSafeMimeType, getImageSafeMimeType } from '../utils/mimeTypes';
import { validBlurHash } from '../utils/blurHash';
import { extractPreviewUrls } from '../utils/messageUrls';
import { trimReplyFromBody } from '../utils/room';
import {
  SocialEmbedOptions,
  SocialEmbedProvider,
  resolveSocialEmbed,
  socialEmbedProvider,
  socialEmbedsEnabled,
} from '../utils/socialEmbed';
import { mimeTypeFromUrl } from '../utils/animatedMedia';
import { useSetting } from '../state/hooks/settings';
import { settingsAtom } from '../state/settings';

/**
 * The parts of `m.image` / `m.video` content this reads.
 *
 * Written out rather than using `IImageContent | IVideoContent`, because the
 * two disagree on `msgtype` and on the shape of `info` — narrowing them apart
 * before knowing which one it is puts the check the wrong way round.
 */
type MediaMessageContent = {
  msgtype?: string;
  body?: string;
  filename?: string;
  url?: string;
  info?: IImageInfo & IVideoInfo & IThumbnailContent;
  file?: IEncryptedFile;
  [MATRIX_GIF_PROPERTY_NAME]?: boolean;
  [MATRIX_SPOILER_PROPERTY_NAME]?: boolean;
  [MATRIX_SPOILER_REASON_PROPERTY_NAME]?: string;
};

export type MediaItemType = 'image' | 'video';

/**
 * Where a gallery entry came from.
 *
 * `attachment` is an `m.image`/`m.video` somebody sent. `embed` is a picture
 * inside a Twitter or Bluesky post that somebody linked — the same media the
 * timeline already renders inline in its preview card, which people remember as
 * "that picture in this conversation" exactly like an upload. Homeserver
 * `og:image` link previews are deliberately not gathered: a site's meta-card
 * image is furniture nobody sent, and folding those in buries the real photos.
 */
export type MediaItemSource = 'attachment' | 'embed';

export type MediaEmbedInfo = {
  provider: SocialEmbedProvider;
  /** The post as linked in the message, for "open the original". */
  postUrl: string;
  authorName?: string;
  authorHandle?: string;
};

export type MediaItem = {
  /**
   * Unique per gallery entry, and the React key everywhere.
   *
   * Not the same thing as `eventId` any more: one linked post can carry four
   * pictures, so one event can produce four entries. For an attachment this is
   * the event id, so nothing about the attachment path changes.
   */
  key: string;
  eventId: string;
  roomId: string;
  sender: string;
  ts: number;
  type: MediaItemType;
  source: MediaItemSource;
  /** What the attachment is called — used for the download and as alt text. */
  filename: string;
  /**
   * The sender's own words about the attachment, when they wrote any.
   *
   * A plain attachment repeats its filename in `body`, and captioning it
   * (MSC2530) is what moves the filename into `filename` and leaves `body` as
   * prose. So a caption exists only when the two differ — the same test
   * RenderMessageContent uses to decide whether to render one.
   */
  caption?: string;
  /** Set for `source: 'attachment'`. Embed media has no Matrix media id. */
  mxcUrl?: string;
  /** Set for `source: 'embed'` — a direct https URL on the provider's CDN. */
  httpUrl?: string;
  /** A still for embed media, when the provider gave one. */
  posterUrl?: string;
  /**
   * True when `httpUrl` is an HLS playlist rather than a file a `<video src>`
   * can take. Bluesky serves every video this way.
   */
  hls?: boolean;
  /** Present for `source: 'embed'`. */
  embed?: MediaEmbedInfo;
  mimeType: string;
  encInfo?: EncryptedAttachmentInfo;
  width?: number;
  height?: number;
  size?: number;
  /** Video length in milliseconds, when the sender reported one. */
  duration?: number;
  blurHash?: string;
  /** The sender-supplied still, if there is one. Required for encrypted video. */
  thumbnail?: IThumbnailContent;
  gif: boolean;
  spoiler: boolean;
  spoilerReason?: string;
};

/**
 * Read an image or video attachment out of a timeline event.
 *
 * Returns undefined for everything that is not one — including redacted
 * events, stickers (which are furniture, not attachments anybody goes looking
 * for) and videos whose declared mimetype is not actually a video, which is the
 * same case MVideo hands off to the file renderer.
 */
/**
 * Every image and video an event contributes.
 *
 * Almost always none or one. An MSC4274 gallery is the exception: one event
 * carrying up to a dozen attachments, which a gallery of pictures has to show
 * as a dozen tiles — the whole point of the grid is that each picture is its
 * own thing to find.
 */
export const mediaItemsFromEvent = (mEvent: MatrixEvent): MediaItem[] => {
  const single = mediaItemFromEvent(mEvent);
  if (single) return [single];
  return galleryItemsFromEvent(mEvent);
};

/** The image/video items of an MSC4274 gallery message, in order. */
const galleryItemsFromEvent = (mEvent: MatrixEvent): MediaItem[] => {
  if (mEvent.isRedacted()) return [];
  if (mEvent.getType() !== MessageEvent.RoomMessage) return [];

  const eventId = mEvent.getId();
  const roomId = mEvent.getRoomId();
  if (!eventId || !roomId) return [];

  const content = mEvent.getContent<{ msgtype?: string; itemtypes?: unknown }>();
  if (!isGalleryMsgType(content.msgtype)) return [];
  if (!Array.isArray(content.itemtypes)) return [];

  const sender = mEvent.getSender() ?? '';
  const ts = mEvent.getTs();

  return content.itemtypes.flatMap((raw, index): MediaItem[] => {
    const item = raw as IGalleryItem & { itemtype?: string };
    let type: MediaItemType;
    if (item.itemtype === MsgType.Image) type = 'image';
    else if (item.itemtype === MsgType.Video) type = 'video';
    else return [];

    const mxcUrl = item.file?.url ?? item.url;
    if (typeof mxcUrl !== 'string') return [];

    const info = item.info as (IImageInfo & IVideoInfo & IThumbnailContent) | undefined;
    const mimeType =
      type === 'image'
        ? getImageSafeMimeType(info?.mimetype)
        : getBlobSafeMimeType(info?.mimetype ?? '');
    if (type === 'video' && !mimeType.startsWith('video')) return [];

    const body = typeof item.body === 'string' ? item.body : '';
    const filename = item.filename || body || (type === 'image' ? 'Image' : 'Video');

    return [
      {
        key: `${eventId}|gallery|${index}`,
        eventId,
        roomId,
        sender,
        ts,
        type,
        source: 'attachment',
        filename,
        caption: item.filename && item.filename !== body ? body : undefined,
        mxcUrl,
        mimeType,
        encInfo: item.file,
        width: typeof info?.w === 'number' ? info.w : undefined,
        height: typeof info?.h === 'number' ? info.h : undefined,
        size: typeof info?.size === 'number' ? info.size : undefined,
        duration: typeof info?.duration === 'number' ? info.duration : undefined,
        blurHash:
          validBlurHash(info?.[MATRIX_BLUR_HASH_PROPERTY_NAME]) ??
          validBlurHash(info?.thumbnail_info?.[MATRIX_BLUR_HASH_PROPERTY_NAME]),
        thumbnail:
          info?.thumbnail_file || info?.thumbnail_url
            ? {
                thumbnail_file: info.thumbnail_file,
                thumbnail_url: info.thumbnail_url,
                thumbnail_info: info.thumbnail_info,
              }
            : undefined,
        gif: (item as Record<string, unknown>)[MATRIX_GIF_PROPERTY_NAME] === true,
        spoiler: (item as Record<string, unknown>)[MATRIX_SPOILER_PROPERTY_NAME] === true,
        spoilerReason: (item as Record<string, unknown>)[MATRIX_SPOILER_REASON_PROPERTY_NAME] as
          string | undefined,
      },
    ];
  });
};

export const mediaItemFromEvent = (mEvent: MatrixEvent): MediaItem | undefined => {
  if (mEvent.isRedacted()) return undefined;
  if (mEvent.getType() !== MessageEvent.RoomMessage) return undefined;

  const eventId = mEvent.getId();
  const roomId = mEvent.getRoomId();
  if (!eventId || !roomId) return undefined;

  const content = mEvent.getContent<MediaMessageContent>();
  let type: MediaItemType;
  if (content.msgtype === MsgType.Image) type = 'image';
  else if (content.msgtype === MsgType.Video) type = 'video';
  else return undefined;

  const mxcUrl = content.file?.url ?? content.url;
  if (typeof mxcUrl !== 'string') return undefined;

  const info = content.info;
  const mimeType =
    type === 'image'
      ? getImageSafeMimeType(info?.mimetype)
      : getBlobSafeMimeType(info?.mimetype ?? '');
  // A video the browser will refuse to play is a file, not gallery media.
  if (type === 'video' && !mimeType.startsWith('video')) return undefined;

  const body = typeof content.body === 'string' ? content.body : '';
  const filename = content.filename || body || (type === 'image' ? 'Image' : 'Video');
  const caption = content.filename && content.filename !== body ? body : undefined;

  return {
    key: eventId,
    eventId,
    roomId,
    sender: mEvent.getSender() ?? '',
    ts: mEvent.getTs(),
    type,
    source: 'attachment',
    filename,
    caption: caption || undefined,
    mxcUrl,
    mimeType,
    encInfo: content.file,
    width: typeof info?.w === 'number' ? info.w : undefined,
    height: typeof info?.h === 'number' ? info.h : undefined,
    size: typeof info?.size === 'number' ? info.size : undefined,
    duration: typeof info?.duration === 'number' ? info.duration : undefined,
    blurHash:
      validBlurHash(info?.[MATRIX_BLUR_HASH_PROPERTY_NAME]) ??
      validBlurHash(info?.thumbnail_info?.[MATRIX_BLUR_HASH_PROPERTY_NAME]),
    thumbnail:
      info?.thumbnail_file || info?.thumbnail_url
        ? {
            thumbnail_file: info.thumbnail_file,
            thumbnail_url: info.thumbnail_url,
            thumbnail_info: info.thumbnail_info,
          }
        : undefined,
    gif: content[MATRIX_GIF_PROPERTY_NAME] === true,
    spoiler: content[MATRIX_SPOILER_PROPERTY_NAME] === true,
    spoilerReason: content[MATRIX_SPOILER_REASON_PROPERTY_NAME],
  };
};

/** Message types whose body can carry a link worth resolving. */
const TEXTUAL_MSGTYPES: ReadonlySet<string> = new Set([
  MsgType.Text as string,
  MsgType.Notice as string,
  MsgType.Emote as string,
]);

/**
 * One Twitter/Bluesky post link found in one message.
 *
 * Exported with `embedMediaItems` so the timeline's preview card can build the
 * exact same gallery entries the scan builds for that message — see there.
 */
export type EmbedCandidate = {
  eventId: string;
  roomId: string;
  sender: string;
  ts: number;
  url: string;
  provider: SocialEmbedProvider;
};

/**
 * The Twitter/Bluesky post links in one message, if it has any.
 *
 * Reads the same two places `UrlPreviewCard` is fed from — the anchor hrefs in
 * `formatted_body` first, the plain body second — via `extractPreviewUrls`, so
 * a link the timeline previews and a link the gallery walks are the same link.
 * A caption on an attachment counts too: `m.image` with a tweet in its caption
 * is one message carrying both kinds of media.
 */
const embedCandidatesFromEvent = (mEvent: MatrixEvent): EmbedCandidate[] => {
  if (mEvent.isRedacted()) return [];
  if (mEvent.getType() !== MessageEvent.RoomMessage) return [];

  const eventId = mEvent.getId();
  const roomId = mEvent.getRoomId();
  if (!eventId || !roomId) return [];

  const content = mEvent.getContent<{
    msgtype?: string;
    body?: string;
    formatted_body?: string;
    filename?: string;
  }>();
  const msgtype = content.msgtype;
  const isCaptioned =
    (msgtype === MsgType.Image || msgtype === MsgType.Video) &&
    !!content.filename &&
    content.filename !== content.body;
  if (!isCaptioned && (typeof msgtype !== 'string' || !TEXTUAL_MSGTYPES.has(msgtype))) return [];

  const body = typeof content.body === 'string' ? trimReplyFromBody(content.body) : '';
  if (!body) return [];
  const formattedBody =
    typeof content.formatted_body === 'string' ? content.formatted_body : undefined;

  const sender = mEvent.getSender() ?? '';
  const ts = mEvent.getTs();

  const candidates: EmbedCandidate[] = [];
  const seenUrls = new Set<string>();
  extractPreviewUrls(body, formattedBody).forEach((url) => {
    const provider = socialEmbedProvider(url);
    if (!provider || seenUrls.has(url)) return;
    seenUrls.add(url);
    candidates.push({ eventId, roomId, sender, ts, url, provider });
  });
  return candidates;
};

export type RoomMedia = {
  /** Every image and video found so far, newest first. */
  items: MediaItem[];
  /** A scan is in flight. */
  loading: boolean;
  /** Older history remains to be walked. */
  hasMore: boolean;
  /** Walk further back. A no-op while a scan is running, or once exhausted. */
  loadMore: () => void;
  /** Timeline events examined so far — the denominator for "found 4 of 900". */
  scanned: number;
  /** Set when the whole scan has produced nothing yet and is still working. */
  started: boolean;
};

type MediaCursor = {
  roomId: string;
  timeline: EventTimeline;
  seen: Set<string>;
  items: MediaItem[];
  /**
   * The key of every entry in `items`, so no add path can list one twice.
   *
   * Load-bearing, not an optimisation. Four separate paths append to `items` —
   * the history walk, a live event, a late decryption, and a resolved post —
   * and they run concurrently: `scanLoaded` marks an event seen, then *awaits*
   * its decryption, and the `Decrypted` listener fires during that await and
   * folds the very same attachment in before the walk gets back to it. The walk
   * then appended it a second time, because it was the one path with no dedupe.
   *
   * Two entries with the same `key` is not a cosmetic duplicate: `key` is the
   * React key of every tile in the grid and every page in the feed, so a
   * collision makes React reuse and discard the wrong nodes — the feed page
   * under the reader is thrown away mid-scan and comes back blank, and a video
   * on it restarts its download from nothing every time. That is the black
   * screen, and it happens only in encrypted rooms, only while the scan is
   * still running, which is exactly when it was reported.
   */
  keys: Set<string>;
  scanned: number;
  exhausted: boolean;
  /** Post links found by the walk and not yet resolved. */
  pendingEmbeds: EmbedCandidate[];
  /** Post links already handed to the resolver, so a re-walk does not repeat them. */
  resolvedEmbeds: Set<string>;
};

/** Events fetched per `/messages` round trip while hunting for attachments. */
const PAGINATION_LIMIT = 80;
/** Round trips one `loadMore()` will spend before handing control back. */
const MAX_PAGINATIONS_PER_LOAD = 6;
/** New attachments that satisfy a `loadMore()` — roughly two grid screens. */
const TARGET_NEW_ITEMS = 24;

const sortNewestFirst = (items: MediaItem[]): MediaItem[] => [...items].sort((a, b) => b.ts - a.ts);

/**
 * The one way anything reaches `cursor.items`.
 *
 * Every caller used to do its own version of this and one of them — the
 * history walk — did not do the dedupe at all; see `MediaCursor.keys` for what
 * that cost. Centralising it means the invariant "one entry per key" is a
 * property of the cursor rather than something four call sites have to
 * remember.
 *
 * `atFront` only decides the order of entries with an *identical* timestamp,
 * since the sort below is stable: a photo that has just been sent belongs above
 * one already listed at the same millisecond, and history that has just become
 * readable belongs below.
 *
 * @returns how many entries were actually new.
 */
const addToCursor = (cursor: MediaCursor, incoming: MediaItem[], atFront = false): number => {
  if (incoming.length === 0) return 0;
  const fresh = incoming.filter((item) => !cursor.keys.has(item.key));
  if (fresh.length === 0) return 0;
  fresh.forEach((item) => cursor.keys.add(item.key));
  cursor.items = sortNewestFirst(
    atFront ? [...fresh, ...cursor.items] : [...cursor.items, ...fresh],
  );
  return fresh.length;
};

/** Posts resolved at once. Enough to fill a screen, few enough to stay polite. */
const EMBED_CONCURRENCY = 4;

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

/**
 * The gallery entries one resolved post contributes.
 *
 * Every picture in the post becomes its own entry, the way four photos in four
 * separate messages would — a gallery is a grid of pictures, not a grid of
 * messages, so a four-image tweet that collapsed to one tile would be hiding
 * three of them.
 */
export const embedMediaItems = (
  candidate: EmbedCandidate,
  post: { authorName?: string; authorHandle?: string; text?: string; media: EmbedMediaLike[] },
): MediaItem[] => {
  const embed: MediaEmbedInfo = {
    provider: candidate.provider,
    postUrl: candidate.url,
    authorName: post.authorName,
    authorHandle: post.authorHandle,
  };
  const who = post.authorHandle ?? post.authorName ?? candidate.provider;

  return post.media.map((media, index) => {
    const mimeType =
      mimeTypeFromUrl(media.url) ??
      media.mimeType ??
      (media.type === 'image' ? 'image/jpeg' : 'video/mp4');
    const extension = EXTENSION_BY_MIME[mimeType] ?? (media.type === 'image' ? 'jpg' : 'mp4');
    const suffix = post.media.length > 1 ? `-${index + 1}` : '';

    return {
      key: `${candidate.eventId}|${candidate.url}|${index}`,
      eventId: candidate.eventId,
      roomId: candidate.roomId,
      sender: candidate.sender,
      ts: candidate.ts,
      type: media.type,
      source: 'embed' as const,
      filename: `${who}${suffix}.${extension}`,
      // The alt text the author wrote beats the post's prose; both beat nothing.
      caption: media.alt || post.text || undefined,
      httpUrl: media.url,
      posterUrl: media.thumbnailUrl,
      hls: media.hls,
      embed,
      mimeType,
      width: media.width,
      height: media.height,
      duration: media.duration,
      gif: media.gif,
      // A linked post carries no Matrix spoiler flag; the sender can only spoil
      // their own attachment.
      spoiler: false,
    };
  });
};

export type EmbedMediaLike = {
  url: string;
  type: MediaItemType;
  thumbnailUrl?: string;
  gif: boolean;
  hls: boolean;
  width?: number;
  height?: number;
  duration?: number;
  alt?: string;
  mimeType?: string;
};

/**
 * Every image and video in a room, newest first, gathered by walking its
 * timeline backwards.
 *
 * Deliberately a client-side scan rather than a server-side `contains_url`
 * filter. That filter is the obvious implementation and it is wrong here: it
 * matches on a `url` field in the *cleartext* content, and an encrypted room
 * has none — so the fast path would return an empty gallery in exactly the
 * rooms this client is usually used in, and would do it silently. The scan
 * costs `/messages` round trips instead, decrypts what it walks, and returns
 * the same answer everywhere. It is the same trade `useClientRoomSearch`
 * already makes for search.
 *
 * `enabled` gates the whole thing so a room view costs nothing until the
 * gallery or the feed is actually opened. Once enabled, what has been found is
 * kept even if it is disabled again — closing and reopening the gallery should
 * not re-walk the room.
 */
export const useRoomMedia = (room: Room, enabled: boolean): RoomMedia => {
  const mx = useMatrixClient();

  // Which providers may be contacted. Read as refs because the scan is a long
  // async walk started from a callback — re-reading the setting at the moment a
  // link is resolved is what makes turning the setting off take effect on the
  // scan already running, instead of only on the next one.
  const [useVxTwitter] = useSetting(settingsAtom, 'useVxTwitter');
  const [useBlueskyEmbeds] = useSetting(settingsAtom, 'useBlueskyEmbeds');
  const [urlPreview] = useSetting(settingsAtom, 'urlPreview');
  const [encUrlPreview] = useSetting(settingsAtom, 'encUrlPreview');
  // The same gate the timeline applies to preview cards. Resolving a linked
  // post is an unprompted request to a host the *sender* chose, so a room where
  // the user has switched previews off must not have its links resolved either.
  const previewsAllowed = room.hasEncryptionStateEvent() ? encUrlPreview : urlPreview;
  const embedOptions: SocialEmbedOptions = useMemo(
    () => ({
      twitter: previewsAllowed && useVxTwitter,
      bluesky: previewsAllowed && useBlueskyEmbeds,
    }),
    [previewsAllowed, useVxTwitter, useBlueskyEmbeds],
  );
  const embedOptionsRef = useRef(embedOptions);
  embedOptionsRef.current = embedOptions;
  const embedsEnabledRef = useRef(socialEmbedsEnabled(embedOptions));
  embedsEnabledRef.current = socialEmbedsEnabled(embedOptions);

  const cursorRef = useRef<MediaCursor | undefined>(undefined);
  const runningRef = useRef(false);
  const aliveRef = useRef(true);

  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanned, setScanned] = useState(0);
  const [exhausted, setExhausted] = useState(false);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const getCursor = useCallback((): MediaCursor => {
    const cursor = cursorRef.current;
    if (cursor && cursor.roomId === room.roomId) {
      // A limited sync detaches the timeline we were paginating and starts a
      // fresh one. Pick that up rather than paginating a token that no longer
      // leads anywhere; `seen` keeps the re-walk from duplicating anything.
      const live = room.getLiveTimeline();
      if (cursor.timeline !== live) {
        cursor.timeline = live;
        cursor.exhausted = false;
      }
      return cursor;
    }
    const fresh: MediaCursor = {
      roomId: room.roomId,
      timeline: room.getLiveTimeline(),
      seen: new Set<string>(),
      items: [],
      keys: new Set<string>(),
      scanned: 0,
      exhausted: false,
      pendingEmbeds: [],
      resolvedEmbeds: new Set<string>(),
    };
    cursorRef.current = fresh;
    return fresh;
  }, [room]);

  /** Fold everything currently in the timeline into the cursor. */
  const scanLoaded = useCallback(
    async (cursor: MediaCursor): Promise<number> => {
      const events = cursor.timeline.getEvents();
      const fresh: MatrixEvent[] = [];
      for (let i = events.length - 1; i >= 0; i -= 1) {
        const mEvent = events[i];
        const id = mEvent.getId();
        if (id && !cursor.seen.has(id)) {
          cursor.seen.add(id);
          cursor.scanned += 1;
          fresh.push(mEvent);
        }
      }

      // Decrypt in parallel — serialising this is what made the equivalent
      // scan in search feel slow. Already-decrypted events report their clear
      // type and are skipped.
      await Promise.all(
        fresh.map((mEvent) =>
          mEvent.isEncrypted() &&
          mEvent.getType() === MessageEvent.RoomMessageEncrypted &&
          !mEvent.isDecryptionFailure()
            ? mx.decryptEventIfNeeded(mEvent).catch(() => undefined)
            : undefined,
        ),
      );

      let added = 0;
      fresh.forEach((mEvent) => {
        // Through `addToCursor` rather than pushing: the `Decrypted` listener
        // fires during the await above and has already folded some of these in.
        added += addToCursor(cursor, mediaItemsFromEvent(mEvent));
        // Queued rather than resolved here: resolving is a network round trip
        // per post, and the walk must not wait on it. The grid shows the
        // attachments it already found and the posts fill in behind them.
        if (embedsEnabledRef.current) {
          embedCandidatesFromEvent(mEvent).forEach((candidate) => {
            const key = `${candidate.eventId}|${candidate.url}`;
            if (cursor.resolvedEmbeds.has(key)) return;
            cursor.resolvedEmbeds.add(key);
            cursor.pendingEmbeds.push(candidate);
          });
        }
      });
      return added;
    },
    [mx],
  );

  /**
   * The last list handed to React, so an unchanged one is not handed over again.
   *
   * `loadMore` publishes after the initial fold and after every page of history,
   * and most of those rounds find nothing. Each one used to mint a fresh array,
   * which is a new identity to every consumer: the feed re-derives its page
   * list and re-runs the layout effect that owns its scroll offset, several
   * times a second, for a list that did not change. `addToCursor` replaces
   * `cursor.items` only when something was actually added, so identity is
   * already the exact test.
   */
  const publishedRef = useRef<MediaItem[] | undefined>(undefined);

  const publish = useCallback((cursor: MediaCursor) => {
    if (!aliveRef.current) return;
    if (publishedRef.current !== cursor.items) {
      publishedRef.current = cursor.items;
      setItems(cursor.items);
    }
    setScanned(cursor.scanned);
    setExhausted(cursor.exhausted);
  }, []);

  const embedRunningRef = useRef(false);

  /**
   * Turn queued post links into gallery entries, a few at a time.
   *
   * Runs alongside the history walk rather than inside it: a room with two
   * hundred linked tweets in it would otherwise make the grid wait on two
   * hundred round trips before showing the photos it already has. Results are
   * published as each batch lands, so pictures appear as they resolve.
   */
  const resolveEmbeds = useCallback(
    async (cursor: MediaCursor) => {
      if (embedRunningRef.current) return;
      embedRunningRef.current = true;
      try {
        while (aliveRef.current && cursor.pendingEmbeds.length > 0) {
          const options = embedOptionsRef.current;
          if (!socialEmbedsEnabled(options)) {
            cursor.pendingEmbeds = [];
            break;
          }
          const batch = cursor.pendingEmbeds.splice(0, EMBED_CONCURRENCY);
          const resolved = await Promise.all(
            batch.map(async (candidate) => {
              const post = await resolveSocialEmbed(candidate.url, options).catch(() => undefined);
              return post ? embedMediaItems(candidate, post) : [];
            }),
          );
          const found = resolved.flat();
          if (found.length === 0) continue;
          if (!aliveRef.current) break;
          if (addToCursor(cursor, found) === 0) continue;
          publish(cursor);
        }
      } finally {
        embedRunningRef.current = false;
      }
    },
    [publish],
  );

  const loadMore = useCallback(() => {
    if (runningRef.current) return;
    const cursor = getCursor();
    if (cursor.exhausted) return;

    runningRef.current = true;
    setLoading(true);
    setStarted(true);

    (async () => {
      // Why this walk stopped where it did. Read by the log below, which is the
      // only way to tell "this room really has two photos in it" apart from
      // "the walk gave up early" from outside the client.
      let stoppedBecause = 'target-reached';
      let added = 0;
      let paginations = 0;

      // Everything below is inside a `try`, because a throw anywhere in the
      // walk used to escape this IIFE as an unhandled rejection and take the
      // gallery down with it for the rest of the session — not just for this
      // room. `runningRef` stayed latched true, so every later `loadMore` (the
      // sentinel's, the filter's, the "Load older media" chip's, the next
      // room's first scan) returned at its first line; `loading` stayed true;
      // and the one line that says why the walk stopped never ran. One
      // unexpected event anywhere in a room's history was enough to do that,
      // and from the outside it looked exactly like a gallery that had decided
      // the conversation has no pictures in it.
      try {
        added = await scanLoaded(cursor);
        publish(cursor);
        // Deliberately not awaited: the walk below carries on while posts
        // resolve, and each batch publishes itself.
        resolveEmbeds(cursor);

        while (
          aliveRef.current &&
          added < TARGET_NEW_ITEMS &&
          !cursor.exhausted &&
          paginations < MAX_PAGINATIONS_PER_LOAD
        ) {
          const token = cursor.timeline.getPaginationToken(EventTimeline.BACKWARDS);
          if (!token) {
            cursor.exhausted = true;
            stoppedBecause = 'no-pagination-token';
            break;
          }
          paginations += 1;
          let ok = false;
          let paginationError: unknown;
          try {
            ok = await mx.paginateEventTimeline(cursor.timeline, {
              backwards: true,
              limit: PAGINATION_LIMIT,
            });
          } catch (err) {
            console.warn('[gallery] pagination threw', err);
            paginationError = err;
            ok = false;
          }
          if (paginationError !== undefined) {
            // NOT `exhausted`: the request FAILED, it did not report the end of
            // the room. The same distinction the scan-threw handler below makes,
            // and for the same reason — `exhausted` is what turns the grid's
            // "Nothing here yet in the part of the conversation that has been
            // read", with **Look further back** under it, into the flat "No
            // photos or videos have been sent in this conversation" with no way
            // to retry. A rate limit, a dropped connection or a server that
            // hiccupped for one request therefore became a permanent, confident
            // denial that the conversation has any pictures in it — and it only
            // took one failed `/messages` on the very first walk.
            stoppedBecause = 'pagination-threw';
            break;
          }
          if (!ok) {
            // A clean `false` IS the end of the room: nothing left to ask for.
            cursor.exhausted = true;
            stoppedBecause = 'pagination-end';
            break;
          }
          added += await scanLoaded(cursor);
          publish(cursor);
        }
      } catch (err) {
        // Not `exhausted`: the walk failed, it did not finish. Leaving
        // `hasMore` true is what keeps "Look further back" on screen, so the
        // grid offers a retry instead of claiming the conversation has no
        // pictures in it.
        stoppedBecause = 'scan-threw';
        console.error('[gallery] scan threw', err);
      } finally {
        publish(cursor);
        resolveEmbeds(cursor);
        // Only when the budget is genuinely why it stopped. A walk whose last
        // allowed round threw has spent the budget too, and mislabelling that
        // as 'pagination-budget' would point the next person reading this log
        // at a walk that ran out of rounds rather than at a homeserver that
        // refused — which is the whole job of this line.
        if (
          stoppedBecause === 'target-reached' &&
          paginations >= MAX_PAGINATIONS_PER_LOAD &&
          !cursor.exhausted
        ) {
          stoppedBecause = 'pagination-budget';
        }
        // One line per `loadMore`, deliberately kept in production builds. The
        // failure this exists for — "the gallery says that is everything and it
        // plainly is not" — is invisible from the UI: an early stop and a genuinely
        // short room look identical, and the difference is which of these numbers
        // is small.
        console.info('[gallery] scan', {
          roomId: cursor.roomId,
          stopped: stoppedBecause,
          eventsScanned: cursor.scanned,
          itemsFound: cursor.items.length,
          newThisRound: added,
          paginations,
          exhausted: cursor.exhausted,
          encrypted: room.hasEncryptionStateEvent(),
          pendingEmbeds: cursor.pendingEmbeds.length,
        });
        runningRef.current = false;
        if (aliveRef.current) setLoading(false);
      }
    })();
  }, [getCursor, mx, publish, scanLoaded, resolveEmbeds, room]);

  // First scan when the gallery (or feed) is opened.
  useEffect(() => {
    if (!enabled) return;
    const cursor = getCursor();
    if (cursor.items.length === 0 && cursor.scanned === 0) {
      loadMore();
      return;
    }
    // Re-opened: show what was already found without re-walking.
    publish(cursor);
    setStarted(true);
  }, [enabled, getCursor, loadMore, publish]);

  // Attachments sent while the gallery is open belong at the top of it, and a
  // redaction has to take one back out — a deleted photo that stays in the grid
  // is worse than one that was never listed.
  useEffect(() => {
    if (!enabled) return undefined;

    const addLive = async (mEvent: MatrixEvent) => {
      const cursor = getCursor();
      const id = mEvent.getId();
      if (!id) return;
      if (
        mEvent.isEncrypted() &&
        mEvent.getType() === MessageEvent.RoomMessageEncrypted &&
        !mEvent.isDecryptionFailure()
      ) {
        await mx.decryptEventIfNeeded(mEvent).catch(() => undefined);
      }
      if (!cursor.seen.has(id)) {
        cursor.seen.add(id);
        cursor.scanned += 1;
      }

      // A tweet posted while the gallery is open belongs at the top of it too.
      if (embedsEnabledRef.current) {
        let queued = false;
        embedCandidatesFromEvent(mEvent).forEach((candidate) => {
          const key = `${candidate.eventId}|${candidate.url}`;
          if (cursor.resolvedEmbeds.has(key)) return;
          cursor.resolvedEmbeds.add(key);
          cursor.pendingEmbeds.push(candidate);
          queued = true;
        });
        if (queued) resolveEmbeds(cursor);
      }

      if (addToCursor(cursor, mediaItemsFromEvent(mEvent), true) === 0) return;
      publish(cursor);
    };

    const handleTimeline: EventTimelineSetHandlerMap[RoomEvent.Timeline] = (
      mEvent,
      eventRoom,
      toStartOfTimeline,
      removed,
      data,
    ) => {
      if (eventRoom?.roomId !== room.roomId || !data.liveEvent) return;
      addLive(mEvent);
    };

    const handleRedaction: RoomEventHandlerMap[RoomEvent.Redaction] = (mEvent, eventRoom) => {
      if (eventRoom?.roomId !== room.roomId) return;
      const targetId = mEvent.getAssociatedId();
      if (!targetId) return;
      const cursor = getCursor();
      const next = cursor.items.filter((item) => item.eventId !== targetId);
      if (next.length === cursor.items.length) return;
      // The key set is what stops an entry being listed twice, so it has to
      // forget the ones being taken out — otherwise a redaction is permanent
      // even if the same attachment turns up again.
      cursor.items.forEach((item) => {
        if (item.eventId === targetId) cursor.keys.delete(item.key);
      });
      cursor.items = next;
      publish(cursor);
    };

    // An attachment whose key had not arrived when the walk passed over it.
    //
    // The scan marks every event it reads as seen and asks it for media once.
    // In an encrypted room that answer is "nothing" for anything still
    // undecryptable at that moment — megolm keys arrive out of band and often
    // late — and because the event is already in `seen`, no later round ever
    // looks at it again. The picture is then missing from the gallery for the
    // rest of the session while sitting perfectly visible in the conversation,
    // which is the difference between "this room has two photos" and "this
    // room has two photos we could read".
    const handleDecrypted: MatrixEventHandlerMap[MatrixEventEvent.Decrypted] = (mEvent) => {
      if (mEvent.getRoomId() !== room.roomId) return;
      const cursor = getCursor();
      const id = mEvent.getId();
      if (!id) return;
      // Not a `seen` check: being seen is exactly the state this repairs.
      if (!cursor.seen.has(id)) {
        cursor.seen.add(id);
        cursor.scanned += 1;
      }

      if (embedsEnabledRef.current) {
        let queued = false;
        embedCandidatesFromEvent(mEvent).forEach((candidate) => {
          const key = `${candidate.eventId}|${candidate.url}`;
          if (cursor.resolvedEmbeds.has(key)) return;
          cursor.resolvedEmbeds.add(key);
          cursor.pendingEmbeds.push(candidate);
          queued = true;
        });
        if (queued) resolveEmbeds(cursor);
      }

      // Appended rather than prepended: this event is history that has just
      // become readable, not something that has just been sent.
      if (addToCursor(cursor, mediaItemsFromEvent(mEvent)) === 0) return;
      publish(cursor);
    };

    room.on(RoomEvent.Timeline, handleTimeline);
    room.on(RoomEvent.Redaction, handleRedaction);
    mx.on(MatrixEventEvent.Decrypted, handleDecrypted);
    return () => {
      room.removeListener(RoomEvent.Timeline, handleTimeline);
      room.removeListener(RoomEvent.Redaction, handleRedaction);
      mx.removeListener(MatrixEventEvent.Decrypted, handleDecrypted);
    };
  }, [enabled, room, mx, getCursor, publish, resolveEmbeds]);

  return useMemo(
    () => ({
      items,
      loading,
      hasMore: !exhausted,
      loadMore,
      scanned,
      started,
    }),
    [items, loading, exhausted, loadMore, scanned, started],
  );
};
