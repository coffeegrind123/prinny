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
 */
export type SoundKind = 'message' | 'invite' | 'call';

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

Object.entries(files).forEach(([path, url]) => {
  const match = path.match(/\/sound-packs\/([^/]+)\/(message|invite|call)\.[^./]+$/);
  if (!match) return;
  const [, pack, kind] = match;
  if (pack === DEFAULT_SOUND_PACK) return;
  packs[pack] = { ...packs[pack], [kind as SoundKind]: url };
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
