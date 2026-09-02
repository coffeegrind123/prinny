/**
 * Match a keyboard event against a hotkey string such as `mod+enter` or
 * `shift+tab`.
 *
 * This is a port of the `is-hotkey` package, restricted to the one export this
 * project used: `isKeyHotkey`, i.e. matching on `event.key` rather than the
 * legacy `event.which` keycode.
 *
 * It is a deliberate port rather than a fresh implementation. The hotkey
 * strings here are not a fixed list: the keybind settings page lets a user
 * capture any combination, storing `event.key.toLowerCase()` prefixed with
 * `mod`/`shift`/`alt`. So the parser has to keep the original's whole surface —
 * aliases, the `+` escaping rule, optional `?` modifiers — because user data
 * already relies on it.
 *
 * Three behaviours that look like details and are not:
 *
 * - Modifiers not named in the hotkey must be ABSENT, not ignored. `enter` does
 *   not match Ctrl+Enter. That falls out of seeding all four modifiers to
 *   `false` before parsing.
 * - `mod` resolves to Meta on Apple platforms and Control everywhere else,
 *   decided once at module load, exactly as the original did.
 * - A `?` suffix marks a modifier optional (`null`), which the comparison skips
 *   rather than requires.
 *
 * Known inherited sharp edge, preserved on purpose: an unrecognised multi-
 * character key name throws a TypeError. A user who binds a key whose
 * `event.key` is a long name absent from the tables below (`dead`,
 * `audiovolumeup`, …) will hit that. Fixing it means changing behaviour, which
 * is a separate change from removing the dependency.
 */

const IS_MAC =
  typeof window !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(window.navigator.platform);

type ModifierKey = 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey';

const MODIFIERS: Record<string, ModifierKey> = {
  alt: 'altKey',
  control: 'ctrlKey',
  meta: 'metaKey',
  shift: 'shiftKey',
};

const ALIASES: Record<string, string> = {
  add: '+',
  break: 'pause',
  cmd: 'meta',
  command: 'meta',
  ctl: 'control',
  ctrl: 'control',
  del: 'delete',
  down: 'arrowdown',
  esc: 'escape',
  ins: 'insert',
  left: 'arrowleft',
  mod: IS_MAC ? 'meta' : 'control',
  opt: 'alt',
  option: 'alt',
  return: 'enter',
  right: 'arrowright',
  space: ' ',
  spacebar: ' ',
  up: 'arrowup',
  win: 'meta',
  windows: 'meta',
};

const CODES: Record<string, number> = {
  backspace: 8,
  tab: 9,
  enter: 13,
  shift: 16,
  control: 17,
  alt: 18,
  pause: 19,
  capslock: 20,
  escape: 27,
  ' ': 32,
  pageup: 33,
  pagedown: 34,
  end: 35,
  home: 36,
  arrowleft: 37,
  arrowup: 38,
  arrowright: 39,
  arrowdown: 40,
  insert: 45,
  delete: 46,
  meta: 91,
  numlock: 144,
  scrolllock: 145,
  ';': 186,
  '=': 187,
  ',': 188,
  '-': 189,
  '.': 190,
  '/': 191,
  '`': 192,
  '[': 219,
  '\\': 220,
  ']': 221,
  "'": 222,
};

for (let f = 1; f < 20; f += 1) {
  CODES[`f${f}`] = 111 + f;
}

const toKeyName = (name: string): string => {
  const lower = name.toLowerCase();
  return ALIASES[lower] ?? lower;
};

type ParsedHotkey = { key?: string } & { [K in ModifierKey]?: boolean | null };

const parseHotkey = (hotkey: string): ParsedHotkey => {
  const ret: ParsedHotkey = {};

  // `+` is the separator, so a literal `+` key is written `++` and rewritten to
  // the `add` alias. Matches the original in only replacing the first instance.
  const values = hotkey.replace('++', '+add').split('+');
  const { length } = values;

  // Every modifier must be explicitly absent unless the hotkey names it.
  Object.keys(MODIFIERS).forEach((k) => {
    ret[MODIFIERS[k]] = false;
  });

  values.forEach((rawValue) => {
    const optional = rawValue.endsWith('?') && rawValue.length > 1;
    const value = optional ? rawValue.slice(0, -1) : rawValue;

    const name = toKeyName(value);
    const modifier = MODIFIERS[name];

    if (value.length > 1 && !modifier && !ALIASES[value] && !CODES[name]) {
      throw new TypeError(`Unknown modifier: "${value}"`);
    }

    if (length === 1 || !modifier) {
      ret.key = name;
    }

    if (modifier) {
      ret[modifier] = optional ? null : true;
    }
  });

  return ret;
};

/**
 * The subset of a keyboard event this reads. Structural on purpose, matching
 * what `@types/is-hotkey` declared: call sites pass both native `KeyboardEvent`
 * and React's synthetic `KeyboardEvent<Element>`, and only a structural type
 * accepts both.
 */
export interface KeyboardEventLike {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

const compareHotkey = (parsed: ParsedHotkey, event: KeyboardEventLike): boolean =>
  (Object.keys(parsed) as Array<keyof ParsedHotkey>).every((key) => {
    const expected = parsed[key];

    // `null` marks an optional modifier — anything goes.
    if (expected == null) return true;

    const actual =
      key === 'key' && event.key != null
        ? event.key.toLowerCase()
        : (event[key as keyof KeyboardEventLike] as unknown);

    if (actual == null && expected === false) return true;

    return actual === expected;
  });

/**
 * Test `event` against one hotkey string or any of several.
 *
 * Called with only a hotkey it returns a predicate, matching the original's
 * curried form.
 */
export function isKeyHotkey(
  hotkey: string | readonly string[],
): (event: KeyboardEventLike) => boolean;
export function isKeyHotkey(hotkey: string | readonly string[], event: KeyboardEventLike): boolean;
export function isKeyHotkey(
  hotkey: string | readonly string[],
  event?: KeyboardEventLike,
): boolean | ((event: KeyboardEventLike) => boolean) {
  const parsed = (Array.isArray(hotkey) ? hotkey : [hotkey as string]).map(parseHotkey);
  const check = (e: KeyboardEventLike): boolean =>
    parsed.some((object) => compareHotkey(object, e));

  return event == null ? check : check(event);
}

export default isKeyHotkey;
