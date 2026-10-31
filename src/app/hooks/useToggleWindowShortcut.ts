import { useEffect } from 'react';
import { atom, useSetAtom } from 'jotai';
import { useSetting } from '../state/hooks/settings';
import { settingsAtom } from '../state/settings';
import { useTauriDesktop } from './useTauriDesktop';

/** Why the OS refused the shortcut (usually: another app holds it), or undefined. */
export const toggleWindowShortcutErrorAtom = atom<string | undefined>(undefined);

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'OS']);

/**
 * A keydown as a global-hotkey accelerator ("Control+Shift+KeyP"), from the
 * physical key so it matches whatever layout the OS hook sees. Null while
 * only modifiers are down, or for a combination that would swallow ordinary
 * typing everywhere: without Ctrl, Alt or Super, only F-keys qualify.
 */
export const eventToAccelerator = (evt: KeyboardEvent): string | null => {
  if (MODIFIER_KEYS.has(evt.key) || !evt.code) return null;

  const fKey = /^F([1-9]|1[0-9]|2[0-4])$/.test(evt.code);
  if (!fKey && !evt.ctrlKey && !evt.altKey && !evt.metaKey) return null;

  const parts: string[] = [];
  if (evt.ctrlKey) parts.push('Control');
  if (evt.altKey) parts.push('Alt');
  if (evt.shiftKey) parts.push('Shift');
  if (evt.metaKey) parts.push('Super');
  parts.push(evt.code);
  return parts.join('+');
};

/** "Control+Shift+KeyP" → ["Ctrl", "Shift", "P"] for display. */
export const acceleratorLabels = (accelerator: string): string[] =>
  accelerator.split('+').map((part) => {
    if (part === 'Control') return 'Ctrl';
    if (part.startsWith('Key')) return part.slice(3);
    if (part.startsWith('Digit')) return part.slice(5);
    return part;
  });

/**
 * Registers the show/hide shortcut with the desktop shell whenever it or the
 * tray setting changes (the shell hides to the tray only when that is on, and
 * minimizes otherwise). Registration is the shell's job, so this lives in the
 * client and runs with settings closed.
 */
export function useToggleWindowShortcut(): void {
  const desktop = useTauriDesktop();
  const [shortcut] = useSetting(settingsAtom, 'toggleWindowShortcut');
  const [minimizeToTray] = useSetting(settingsAtom, 'minimizeToTray');
  const setError = useSetAtom(toggleWindowShortcutErrorAtom);

  useEffect(() => {
    if (!desktop) return undefined;

    let live = true;
    import('@tauri-apps/api/core')
      .then(({ invoke }) =>
        invoke('set_toggle_window_shortcut', {
          shortcut: shortcut || null,
          hideToTray: minimizeToTray,
        }),
      )
      .then(() => {
        if (live) setError(undefined);
      })
      .catch((err) => {
        console.warn('[toggle-shortcut] registration failed:', err);
        if (live) setError(typeof err === 'string' ? err : String(err));
      });

    return () => {
      live = false;
    };
  }, [desktop, shortcut, minimizeToTray, setError]);
}
