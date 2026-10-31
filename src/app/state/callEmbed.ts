import { atom } from 'jotai';
import { CallEmbed } from '../plugins/call';

const baseCallEmbedAtom = atom<CallEmbed | undefined>(undefined);

export const callEmbedAtom = atom<CallEmbed | undefined, [CallEmbed | undefined], void>(
  (get) => get(baseCallEmbedAtom),
  (get, set, callEmbed) => {
    const prevCallEmbed = get(baseCallEmbedAtom);
    if (callEmbed === prevCallEmbed) return;

    if (prevCallEmbed) {
      prevCallEmbed.dispose();
    }

    set(baseCallEmbedAtom, callEmbed);
  },
);

export const callChatAtom = atom<boolean>(false);

/** True while the user has been inactive in the call view, so the call UI can fade out. */
export const callIdleAtom = atom<boolean>(false);

/** True while the call view is fullscreened, so the app chrome (sidebars, top bar) can hide. */
export const callFullscreenAtom = atom<boolean>(false);
