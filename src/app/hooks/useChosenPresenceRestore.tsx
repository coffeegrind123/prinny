import { useEffect, useRef } from 'react';
import { applyOwnPresence, republishProfileStatus, useChosenPresence } from '../state/ownPresence';
import { useSetting } from '../state/hooks/settings';
import { settingsAtom } from '../state/settings';
import { useMatrixClient } from './useMatrixClient';
import { useShellLayout } from './useShellLayout';
import { Presence } from './useUserPresence';

/**
 * Re-applies the presence picked in the profile menu when the client starts,
 * since the sync loop would otherwise mark the user online again. Turning the
 * picker off goes back to plain online; the choice is kept for turning it on.
 */
export function ChosenPresenceRestore() {
  const mx = useMatrixClient();
  const [presencePicker] = useSetting(settingsAtom, 'presencePicker');
  const { topBarProfile } = useShellLayout();
  // Only while the picker is reachable; otherwise there is no way back out.
  const enabled = presencePicker && topBarProfile;
  const chosen = useChosenPresence();
  const restored = useRef(false);
  const wasEnabled = useRef(enabled);

  useEffect(() => {
    if (!enabled) {
      if (wasEnabled.current && chosen !== Presence.Online) {
        applyOwnPresence(mx, Presence.Online).catch(() => undefined);
        // Invisible took a shared status off the profile; back to online
        // puts it back (a no-op when sharing is off).
        if (chosen === Presence.Offline) {
          republishProfileStatus(mx, Presence.Online).catch(() => undefined);
        }
      }
      wasEnabled.current = false;
      restored.current = false;
      return;
    }
    wasEnabled.current = true;

    // Account data can arrive after mount on a first sync, so this waits for a
    // non-online choice to show up rather than reading it once. Later changes
    // come from the picker, which applies them itself.
    if (restored.current || chosen === Presence.Online) {
      return;
    }
    restored.current = true;
    applyOwnPresence(mx, chosen).catch(() => undefined);
  }, [mx, enabled, chosen]);

  return null;
}
