import { atom } from 'jotai';
import { SocialEmbedPost } from '../utils/socialEmbed';

/**
 * Whether the room view is showing its media gallery instead of the timeline.
 *
 * Ephemeral, like `roomSearchOpenAtom` — a gallery belongs to the room you
 * opened it in, so switching rooms puts you back in the conversation.
 */
export const roomGalleryOpenAtom = atom<boolean>(false);

export type MediaFeedRequest = {
  roomId: string;
  /** The attachment the feed opens on. The rest of the room's media surrounds it. */
  eventId: string;
  /**
   * The exact gallery entry, when the request came from one.
   *
   * An event id is no longer unique: a linked post with four pictures in it is
   * one event and four entries, so opening the third picture has to say which
   * one. Requests raised from the timeline (a tap on a photo) still carry only
   * the event id, and the feed falls back to the first entry for it.
   */
  itemKey?: string;
  /**
   * The linked post behind the request, when it came from a preview card.
   *
   * A picture inside a Twitter or Bluesky card is a gallery entry like any
   * other, but only *after* the media scan has walked back as far as the
   * message carrying the link and resolved it — which for anything but the
   * last few messages it has not, and for an embed cannot be forced by walking
   * further, because resolution is a network round trip that lands whenever it
   * lands. Waiting for it would mean opening the feed on some other picture and
   * jumping later, which is exactly the "it opens one I clicked on before"
   * complaint the item key was introduced to fix.
   *
   * So the card hands over what it has already fetched. The feed seeds itself
   * with those entries, opens on the right one immediately, and lets the scan
   * fill the rest of the room in around it — the seeds dedupe against the scan
   * by key, so the same picture arriving from both paths is still one entry.
   */
  embed?: MediaFeedEmbedSeed;
};

export type MediaFeedEmbedSeed = {
  /**
   * When the message carrying the link was sent, so the seeded entries sort
   * into the feed where the conversation actually put them.
   */
  ts: number;
  /** The post as the card fetched it, normalised by `socialEmbed`. */
  post: SocialEmbedPost;
  /** Which of `post.media` was clicked. */
  index: number;
};

/**
 * A request to open the full-screen media feed at one attachment.
 *
 * An atom rather than a callback passed down through the message renderers:
 * the request is raised from inside a timeline message (a tap on a photo), from
 * a gallery tile, and from the video overlay button, and all three are many
 * levels below the room view that actually mounts the feed. Only one feed is
 * ever open, so a single atom is the whole state.
 */
export const mediaFeedRequestAtom = atom<MediaFeedRequest | undefined>(undefined);
