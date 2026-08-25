import {
  DEFAULT_NOTIFICATION_CONTENT_MODE,
  NotificationContentMode,
} from '../utils/desktop-notifications';
import { atom } from 'jotai';

const STORAGE_KEY = 'settings';
export type DateFormat =
  | 'D MMM YYYY'
  | 'DD/MM/YYYY'
  | 'MM/DD/YYYY'
  | 'YYYY/MM/DD'
  | 'YYYY-MM-DD'
  | '';
export type MessageSpacing = '0' | '100' | '200' | '300' | '400' | '500';
/**
 * Which tab the Inbox opens on.
 *
 * Stored as the tab's own name rather than a path, so the setting survives any
 * later change to the routes and does not put a URL in local storage.
 */
export type InboxTabId = 'all' | 'notifications' | 'invites';

export enum MessageLayout {
  Modern = 0,
  Compact = 1,
  Bubble = 2,
}

export interface Settings {
  themeId?: string;
  useSystemTheme: boolean;
  lightThemeId?: string;
  darkThemeId?: string;
  monochromeMode?: boolean;
  isMarkdown: boolean;
  editorToolbar: boolean;
  twitterEmoji: boolean;
  pageZoom: number;
  /**
   * Send read receipts privately, so nobody is told how far you have read.
   *
   * Split out of the old `hideActivity`, which switched this and typing
   * together. They are unrelated signals — "don't broadcast what I have read"
   * and "don't broadcast that I am composing" — and wanting one without the
   * other is the normal case, not an edge one. `migrateSettings` carries an
   * existing `hideActivity` onto both.
   *
   * **Sending only.** It used to hide everyone else's receipts in return, which
   * is a different wish wearing the same switch: "I don't want people watching
   * whether I have read them yet" says nothing about wanting to stop seeing
   * theirs, and the reciprocal half was a price nobody chose to pay. What you
   * are shown is `hideOthersReadReceipts`.
   */
  hideReadReceipts: boolean;
  /** Send no typing notifications. Sending only — see `hideReadReceipts`. */
  hideTypingStatus: boolean;
  /** Do not show other people's read receipts. Independent of what you send. */
  hideOthersReadReceipts: boolean;
  /** Do not show other people's typing notifications. */
  hideOthersTypingStatus: boolean;
  /**
   * Send several attachments as one MSC4274 gallery message.
   *
   * Off by default: the msgtype is still the unstable `dm.filament.gallery`, so
   * a client that has not implemented it renders the fallback body and none of
   * the pictures. Receiving one always works regardless of this setting.
   */
  galleryUploads: boolean;

  minimizeToTray: boolean;

  unreadDirectsOnly: boolean;
  unreadRoomsOnly: boolean;

  isPeopleDrawer: boolean;
  memberSortFilterIndex: number;
  enterForNewline: boolean;
  /**
   * Double-clicking a message starts a reply to it.
   *
   * Registered as a gesture in the keybind registry (`reply-double-click`) so
   * it is discoverable in the shortcuts list and switchable in the keybind
   * settings, alongside the `r` binding that does the same thing.
   */
  replyOnDoubleClick: boolean;
  scrollOnSend: boolean;
  defaultInboxTab: InboxTabId;
  messageLayout: MessageLayout;
  messageSpacing: MessageSpacing;
  hideMembershipEvents: boolean;
  hideNickAvatarEvents: boolean;
  mediaAutoLoad: boolean;
  mediaFeedViewer: boolean;
  urlPreview: boolean;
  encUrlPreview: boolean;
  showHiddenEvents: boolean;
  legacyUsernameColor: boolean;

  showNotifications: boolean;
  isNotificationSounds: boolean;

  hour24Clock: boolean;
  dateFormatString: string;

  developerTools: boolean;
  keybinds: Record<string, string>;
  // Widths of the draggable layout columns, keyed by pane id and measured in
  // the same design pixels every other width in this app uses (`toRem`'s
  // input, i.e. 1/16rem units) so a stored width means the same thing at any
  // page zoom. A record rather than one field per pane: panes come and go, and
  // an unknown key is simply ignored while a missing one falls back to that
  // pane's default. Clamping lives in `useResizablePane`, not here, so a hand
  // -edited or stale value can never wedge a column off-screen.
  paneSizes: Record<string, number>;
  readReceiptStyle: 'cinny' | 'element';
  useVxTwitter: boolean;
  useSoundcloak: boolean;
  useBlueskyEmbeds: boolean;
  // Builds Hacker News cards from HN's own API instead of the homeserver
  // preview. HN publishes no OpenGraph metadata at all, so the preview falls
  // back to scraping the page and the description comes out as the site's
  // navigation strip — there is no rendering fix for that, only a different
  // source. The mildest of the embed integrations: the host is fixed and the
  // only sender-controlled part of the request is a numeric item id.
  useHackerNewsEmbeds: boolean;
  // How much of a message is shown in OS notifications. Decrypted end-to-end
  // encrypted content otherwise crosses into the platform notification store,
  // where other software on the device can read it. Defaults to 'full' so
  // existing installs are unchanged; 'sender-only' and 'hidden' are opt-in.
  notificationContentMode: NotificationContentMode;
  usePiped: boolean;
  // Which Piped instance to embed from. '' means auto — pick the first reachable
  // one from the curated list (see utils/piped.ts). A specific origin pins it.
  pipedInstance: string;
  clientPreviewFallback: boolean;
  // Renders LaTeX sent as MSC2191 `data-mx-maths`. Off by default: it is a
  // niche need, and leaving it off means messages show the sender's plain-text
  // fallback instead of running a formula engine over their input.
  renderMaths: boolean;
  // Draws location messages as a map instead of a link. Off by default: every
  // map drawn fetches tiles from whoever serves the style, disclosing an IP and
  // a viewport, and doing that unprompted for a message someone else sent is
  // the same trade the other embed toggles below guard against.
  showMaps: boolean;
  // Microphone selection and processing, shared by voice messages and calls.
  // An empty device id means "whatever the system considers default", which is
  // what most people want and what survives plugging a headset in and out.
  // Asks the OS to exclude the window from screenshots and screen recordings.
  // Honoured on Windows and macOS; on most Linux desktops it does nothing, so
  // the settings tile says so rather than implying a guarantee.
  contentProtection: boolean;
  audioInputId: string;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  // Telegram Bot API token, used only to import sticker packs from
  // t.me/addstickers links. Telegram serves sticker sets nowhere else — the
  // link itself carries no sticker data — and the Bot API returns 401 without
  // a token. Empty string means the import UI stays hidden.
  telegramBotToken: string;
  // Draws `app.prinny.bot.reply_markup` keyboards from bot messages as real
  // buttons. On by default — that is the feature — but it is a per-account off
  // switch because the buttons come from whoever sent the message, and someone
  // who does not want arbitrary room members rendering interactive controls in
  // their timeline should be able to say so. Off falls back to the message's
  // plain-text listing, which every bot sends anyway.
  renderBotKeyboards: boolean;
  // Confirm before opening a URL from a bot button, showing the real host.
  // On by default and there is no good reason to turn it off: the label on a
  // button says whatever its sender wants, and the host is the only part of it
  // the sender cannot lie about.
  confirmBotUrls: boolean;

  // ── Ported from largelanguagemeowing/cinny ────────────────────────────
  // Everything below defaults off: each one changes a layout or a habit that
  // already works, so it is opted into rather than sprung on an existing
  // install. The shell settings can be enabled in any combination, but two of
  // them describe the same slot: moving the rooms out of Home hands that slot
  // to the direct messages, or nothing would be left in it. `useShellLayout`
  // resolves the pair, and `topBarProfile` needs `topBar` to have a bar.

  // Home and Direct Messages share one sidebar slot, listing orphan rooms and
  // DMs together. Off keeps the two separate tabs.
  unifiedHomeSidebar: boolean;
  // Unread DMs appear as avatar buttons under Home in the client rail.
  dmRailButtons: boolean;
  // A full-width bar above the sidebar carrying the inbox.
  topBar: boolean;
  // Moves the profile controls into that bar. Ignored while `topBar` is off.
  topBarProfile: boolean;
  // Spaceless rooms get their own server-like entry in the space rail rather
  // than living inside Home.
  roomsPseudoSpace: boolean;

  // Third tab in the emoji board backed by the Klipy GIF API. Off by default
  // because every search leaves the client to a third-party host, disclosing
  // an IP and a query to someone who is not the homeserver. Favourites and the
  // composer shortcut follow this setting rather than having their own.
  gifPicker: boolean;
  // Fourth tab in the emoji board: Google's Emoji Kitchen, 147,000 hand-drawn
  // pairings of 619 emoji. Off by default for the same reason as the GIF tab —
  // browsing it fetches thumbnails from gstatic.com, so which emoji you are
  // looking at goes to Google along with your IP. The index of which pairings
  // exist is bundled, so no search or lookup leaves the client; only the
  // pictures do.
  emojiMashup: boolean;
  // Media does not autoplay; it plays while hovered instead. Also stops UI
  // animation, for motion sensitivity and for weak hardware.
  lowAnimationMode: boolean;
  // Hosts whose direct video links are inlined and played in place rather than
  // rendered as a preview card. Empty by default: autoplaying from a host
  // because a message named it is the same unprompted-fetch trade the embed
  // toggles above guard against, so the list is opt-in and hand-curated.
  mediaAutoEmbedHosts: string[];

  // Renders other people's MSC4320 rich presence (now playing / activity) in
  // profile cards and beside their names.
  showRichPresence: boolean;
  // Binds a Discord-compatible local IPC socket so RPC-aware apps publish
  // their activity as this account's rich presence. Desktop only, and off by
  // default because claiming that socket is something the user should ask for.
  publishRichPresence: boolean;

  // `:sob:` becomes an emoji on the closing colon, without the autocomplete
  // menu. Off by default: it rewrites literal `:text:` the user meant to keep.
  emojiShortcodeReplace: boolean;

  // Opening a space lobby joins every unjoined room in it, and joins new ones
  // as they are added. Off by default: a large space means dozens of joins and
  // the sync traffic that follows.
  autoJoinSpaceRooms: boolean;
  // Only share message keys with cross-signed sessions. Off by default because
  // it breaks sending to anyone who has an unverified session of their own.
  onlySignedDevices: boolean;
}

const defaultSettings: Settings = {
  themeId: undefined,
  useSystemTheme: true,
  lightThemeId: undefined,
  darkThemeId: undefined,
  monochromeMode: false,
  isMarkdown: true,
  editorToolbar: false,
  twitterEmoji: true,
  pageZoom: 100,
  hideReadReceipts: false,
  hideTypingStatus: false,
  hideOthersReadReceipts: false,
  hideOthersTypingStatus: false,
  galleryUploads: false,

  minimizeToTray: true,

  unreadDirectsOnly: false,
  unreadRoomsOnly: false,

  isPeopleDrawer: true,
  memberSortFilterIndex: 0,
  enterForNewline: false,
  // On by default: this is the behaviour the client already had.
  replyOnDoubleClick: true,
  scrollOnSend: true,
  defaultInboxTab: 'all',
  messageLayout: 0,
  messageSpacing: '400',
  hideMembershipEvents: false,
  hideNickAvatarEvents: true,
  mediaAutoLoad: true,
  // Tapping a photo in the timeline opens the room's media feed at that photo
  // rather than a single-image lightbox — the same list the gallery shows, so
  // the next attachment is one flick away. Off puts the zoom/pan viewer back
  // as the tap target; the feed keeps its own zoom control either way.
  mediaFeedViewer: true,
  urlPreview: true,
  // On by default (product decision, 2026-08-11). Worth stating plainly rather
  // than leaving implicit: asking for a preview of a URL inside an end-to-end
  // encrypted message sends that URL to the homeserver, which could not read it
  // out of the ciphertext otherwise. Link previews in encrypted rooms are what
  // people expect to just work, and the settings tile says what it costs, so
  // this defaults on and can be switched off there.
  encUrlPreview: true,
  showHiddenEvents: false,
  legacyUsernameColor: false,

  showNotifications: true,
  isNotificationSounds: true,

  hour24Clock: false,
  dateFormatString: 'D MMM YYYY',

  developerTools: false,
  keybinds: {},
  paneSizes: {},
  readReceiptStyle: 'cinny',
  // These third-party front-end integrations make the client fetch, unprompted,
  // from a host chosen by whoever sent the message — which discloses the
  // viewer's IP to that host and turns "did you open the room yet?" into a
  // signal the sender can observe.
  //
  // vxtwitter, Bluesky and Hacker News are on by default as a deliberate
  // product decision: they are the embeds users expect to just work, and the
  // settings tiles state the disclosure plainly so each can be turned off.
  // soundcloak stays opt-in.
  useVxTwitter: true,
  useSoundcloak: false,
  useBlueskyEmbeds: true,
  useHackerNewsEmbeds: true,
  notificationContentMode: DEFAULT_NOTIFICATION_CONTENT_MODE,
  // On by default, pinned to gmach. Piped is the privacy-preserving option
  // here, not the risky one: without it a YouTube link embeds youtube.com
  // directly, which is the disclosure the other embed toggles exist to avoid.
  // Pinned rather than left on auto so the instance is predictable; if it is
  // unreachable, resolvePipedInstance still falls back to the auto probe.
  usePiped: true,
  pipedInstance: 'https://piped.gmach.online',
  // Same reasoning: the client-side OG fallback fetches an arbitrary
  // message-supplied URL straight from the user's own machine.
  clientPreviewFallback: false,
  renderMaths: false,
  showMaps: false,
  contentProtection: false,
  audioInputId: '',
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  telegramBotToken: '',
  renderBotKeyboards: true,
  confirmBotUrls: true,

  unifiedHomeSidebar: false,
  dmRailButtons: false,
  topBar: false,
  topBarProfile: false,
  roomsPseudoSpace: false,

  gifPicker: false,
  emojiMashup: false,
  lowAnimationMode: false,
  mediaAutoEmbedHosts: [],

  showRichPresence: false,
  publishRichPresence: false,

  emojiShortcodeReplace: false,

  autoJoinSpaceRooms: false,
  onlySignedDevices: false,
};

/** Settings that existed under a different shape in an older build. */
type LegacySettings = Partial<Settings> & {
  /** One switch over typing AND read receipts, split in two — see `Settings`. */
  hideActivity?: boolean;
};

/**
 * Bring a persisted blob up to the current shape.
 *
 * A migration rather than a default: someone who turned `hideActivity` on chose
 * to be invisible, and silently reverting them to broadcasting because the key
 * was renamed would be a privacy regression, not a cosmetic one. The old key is
 * dropped from the result, so it disappears from storage on the next write.
 */
const migrateSettings = (stored: LegacySettings): Partial<Settings> => {
  const { hideActivity, ...settings } = stored;
  if (typeof hideActivity !== 'boolean') return settings;

  return {
    ...settings,
    // An explicit value for either new key wins — the user has already answered
    // this question in the new shape, and the old key is only a fallback.
    //
    // Only the *sending* half is carried over. `hideActivity` also hid everyone
    // else's receipts and typing, but nobody asked for that: it rode along on a
    // switch whose stated purpose was to stop broadcasting, and showing it again
    // discloses nothing about the person who turned it on. `hideOthers*`
    // therefore starts off, and is theirs to turn on if they want the quiet.
    hideReadReceipts: settings.hideReadReceipts ?? hideActivity,
    hideTypingStatus: settings.hideTypingStatus ?? hideActivity,
  };
};

export const getSettings = (): Settings => {
  const settings = localStorage.getItem(STORAGE_KEY);
  if (settings === null) return defaultSettings;
  // A malformed or non-object persisted blob used to throw here. This runs at
  // module evaluation time, so the throw escaped before any error boundary
  // existed and bricked the client until localStorage was cleared by hand.
  // Anything we can't understand falls back to the defaults instead.
  try {
    const parsed: unknown = JSON.parse(settings);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return defaultSettings;
    }
    return {
      ...defaultSettings,
      ...migrateSettings(parsed as LegacySettings),
    };
  } catch {
    return defaultSettings;
  }
};

export const setSettings = (settings: Settings) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
};

const baseSettings = atom<Settings>(getSettings());
export const settingsAtom = atom<Settings, [Settings], undefined>(
  (get) => get(baseSettings),
  (get, set, update) => {
    set(baseSettings, update);
    setSettings(update);
  }
);
