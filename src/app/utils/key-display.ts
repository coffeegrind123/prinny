import { KeySymbol } from './key-symbol';
import { isMacOS } from './user-agent';

const KEY_NAME_MAP: Record<string, string> = {
  mod: isMacOS() ? KeySymbol.Command : 'Ctrl',
  ctrl: 'Ctrl',
  shift: KeySymbol.Shift,
  alt: isMacOS() ? KeySymbol.Option : 'Alt',
  meta: isMacOS() ? KeySymbol.Command : 'Meta',
  escape: 'Esc',
  enter: 'Enter',
  backspace: 'Backspace',
  delete: 'Del',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  pageup: 'Page Up',
  pagedown: 'Page Down',
  space: 'Space',
  tab: 'Tab',
  '+': '+',
  '/': '/',
};

/**
 * The parts of a combo, in the order they are pressed.
 *
 * Follows the hotkey parser's own rules so what is shown is what will match:
 * `+` is the separator, so a literal plus is written `++` or as the `add`
 * alias, and a modifier suffixed `?` is optional — it is left out of the
 * display, because a key that works with or without Shift is shown as the key.
 * Splitting on `+` alone turned the bare `+` binding into two empty keycaps.
 */
function comboParts(keyString: string): string[] {
  return keyString
    .replace(/^\+$/, 'add')
    .replace('++', '+add')
    .split('+')
    .map((k) => k.trim())
    .filter((k) => k.length > 0 && !k.endsWith('?'))
    .map((k) => k.toLowerCase())
    .map((k) => (k === 'add' ? '+' : k))
    .map((k) => KEY_NAME_MAP[k] ?? k.toUpperCase());
}

export function formatKeyCombo(keyString: string): string {
  return comboParts(keyString).join('');
}

export function formatKeyComboSplit(keyString: string): string[] {
  return comboParts(keyString);
}
