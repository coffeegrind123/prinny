import { useEffect, useState } from 'react';
import { CallEmbed } from '../plugins/call';
import { isUserId } from '../utils/matrix';
import { useCallJoined } from './useCallEmbed';

const sameSet = (a: Set<string>, b: Set<string>): boolean =>
  a.size === b.size && Array.from(b).every((id) => a.has(id));

/**
 * Who is speaking, and who is sharing a screen, in the call the embed has
 * joined — read off Element Call's own tiles.
 */
export const useCallParticipantActivity = (callEmbed?: CallEmbed) => {
  const [speakers, setSpeakers] = useState(new Set<string>());
  const [screenSharers, setScreenSharers] = useState(new Set<string>());
  const joined = useCallJoined(callEmbed);

  useEffect(() => {
    setSpeakers(new Set());
    setScreenSharers(new Set());
    if (!callEmbed || !joined) return undefined;

    let observer: MutationObserver | undefined;
    const observeDocument = () => {
      observer?.disconnect();
      const { document } = callEmbed;
      const window = callEmbed.iframe.contentWindow;
      if (!document || !window) return;

      const update = () => {
        const speaking = new Set<string>();
        const sharing = new Set<string>();
        // Re-read every tile: a mutation batch only holds the tiles that
        // changed, so building the set from it dropped everyone still talking.
        document.querySelectorAll('[data-video-fit]').forEach((element) => {
          const background = window.getComputedStyle(element, '::before').backgroundImage;
          const userId = Array.from(element.querySelectorAll('[aria-label]'))
            .map((el) => el.getAttribute('aria-label'))
            .find((label): label is string => !!label && isUserId(label));
          if (!userId) return;
          // Element Call marks local and remote presentation tiles with this suffix.
          if (element.getAttribute('data-id')?.endsWith(':screen-share')) sharing.add(userId);
          else if (background && background !== 'none') speaking.add(userId);
        });
        setScreenSharers((previous) => (sameSet(previous, sharing) ? previous : sharing));
        setSpeakers((previous) => (sameSet(previous, speaking) ? previous : speaking));
      };

      // Tiles mount after the join and are replaced whenever the layout
      // changes, so watch the whole document rather than the tiles present now.
      observer = new MutationObserver(update);
      observer.observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'aria-label', 'data-id'],
      });
      update();
    };

    observeDocument();
    // A reload of the iframe swaps its document out from under the observer.
    callEmbed.iframe.addEventListener('load', observeDocument);
    return () => {
      observer?.disconnect();
      callEmbed.iframe.removeEventListener('load', observeDocument);
    };
  }, [callEmbed, joined]);

  return {
    speakers: callEmbed && joined ? speakers : new Set<string>(),
    screenSharers: callEmbed && joined ? screenSharers : new Set<string>(),
  };
};

export const useCallSpeakers = (callEmbed?: CallEmbed): Set<string> =>
  useCallParticipantActivity(callEmbed).speakers;
