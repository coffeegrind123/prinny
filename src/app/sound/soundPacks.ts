import DefaultMessage from '../../../public/sound/notification.ogg';
import DefaultInvite from '../../../public/sound/invite.ogg';
import DefaultCall from '../../../public/sound/call.ogg';

/**
 * Alternative message, invite and incoming-call sounds (Settings →
 * Notifications → Sound Pack). The default pack is the app's own sounds.
 *
 * Every other pack is a folder in `public/sound-packs/<pack>/` holding
 * `message`, and optionally `invite` and `call`, as .ogg/.mp3/.wav; a missing
 * sound falls back to the default. They are found by glob, so removing a pack
 * (or the whole folder) needs no code change: anyone who had it selected just
 * hears the default sounds again.
 *
 * A pack can also replace sounds the call widget plays itself (see
 * CALL_WIDGET_SOUNDS); a missing one keeps the widget's own.
 */
export type SoundKind = 'message' | 'invite' | 'call';

/**
 * Pack file name -> the Element Call sound it replaces, passed to the widget
 * as its `soundOverrides` URL parameter (element-call/patches/0005).
 */
const CALL_WIDGET_SOUNDS = {
  ringback: 'ringtone', // our outgoing call ringing, looped
  callStart: 'ringtoneIntro', // played once before that loop
  callJoin: 'join',
  callLeave: 'left',
  callDeclined: 'decline',
  callTimeout: 'timeout',
} as const;
type CallWidgetSoundFile = keyof typeof CALL_WIDGET_SOUNDS;

export const DEFAULT_SOUND_PACK = 'default';

const PACK_LABELS: Record<string, string> = {
  icq: 'ICQ 7',
  'icq-classic': 'ICQ (classic)',
  skype: 'Skype',
  'skype-classic': 'Skype (classic)',
};

const files = import.meta.glob<string>('../../../public/sound-packs/*/*.{ogg,mp3,wav}', {
  eager: true,
  query: '?url',
  import: 'default',
});

const packs: Record<string, Partial<Record<SoundKind, string>>> = {
  [DEFAULT_SOUND_PACK]: { message: DefaultMessage, invite: DefaultInvite, call: DefaultCall },
};
const callWidgetPacks: Record<string, Partial<Record<CallWidgetSoundFile, string>>> = {};

Object.entries(files).forEach(([path, url]) => {
  const match = path.match(/\/sound-packs\/([^/]+)\/([A-Za-z]+)\.[^./]+$/);
  if (!match) return;
  const [, pack, kind] = match;
  if (pack === DEFAULT_SOUND_PACK) return;
  if (kind === 'message' || kind === 'invite' || kind === 'call') {
    packs[pack] = { ...packs[pack], [kind]: url };
  } else if (kind in CALL_WIDGET_SOUNDS) {
    callWidgetPacks[pack] = { ...callWidgetPacks[pack], [kind as CallWidgetSoundFile]: url };
  }
});

/** Packs to offer, default first. A pack with no message sound is not offered. */
export const SOUND_PACKS: { id: string; label: string }[] = Object.keys(packs)
  .filter((id) => packs[id].message)
  .map((id) => ({
    id,
    label: id === DEFAULT_SOUND_PACK ? 'Default' : (PACK_LABELS[id] ?? id),
  }));

export const getSoundUrl = (pack: string, kind: SoundKind): string =>
  packs[pack]?.[kind] ?? (packs[DEFAULT_SOUND_PACK][kind] as string);

/**
 * The call widget's `soundOverrides`: Element Call sound name -> absolute URL
 * of the pack's replacement. Empty for the default pack, or a pack with none.
 * Absolute because the widget is a page on another path, where a relative
 * asset URL would not resolve.
 */
export const getCallWidgetSoundOverrides = (pack: string): Record<string, string> => {
  const overrides: Record<string, string> = {};
  Object.entries(callWidgetPacks[pack] ?? {}).forEach(([file, url]) => {
    overrides[CALL_WIDGET_SOUNDS[file as CallWidgetSoundFile]] = new URL(
      url,
      window.location.href,
    ).href;
  });
  return overrides;
};
