import { atom } from 'jotai';
import { isMacOS } from '../utils/user-agent';

export enum KeybindCategory {
  Messages = 'Messages',
  Navigation = 'Navigation',
  Formatting = 'Formatting',
  Chat = 'Chat',
  Input = 'Input',
  Call = 'Call',
  MediaViewer = 'Media Viewer',
  EmojiPicker = 'Emoji Picker',
}

/** The order both the shortcuts panel and the settings page list categories in. */
export const KEYBIND_CATEGORY_ORDER: KeybindCategory[] = [
  KeybindCategory.Messages,
  KeybindCategory.Navigation,
  KeybindCategory.Formatting,
  KeybindCategory.Chat,
  KeybindCategory.Input,
  KeybindCategory.Call,
  KeybindCategory.MediaViewer,
  KeybindCategory.EmojiPicker,
];

// Pointer-gesture labels. A gesture's `defaultKeys` is shown verbatim, so the
// platform's modifier name is baked in here rather than mapped at render time.
const MOD_LABEL = isMacOS() ? '⌘' : 'Ctrl';

export interface KeybindDefinition {
  id: string;
  description: string;
  category: KeybindCategory;
  /**
   * The key combo, or — when `gesture` is set — the literal label to show for
   * a pointer gesture that has no combo to capture.
   */
  defaultKeys: string;
  /**
   * A pointer gesture rather than a key.
   *
   * It lives in this registry because this is where a user looks to find out
   * what the client responds to, and a gesture nobody can discover may as well
   * not exist. It is not rebindable — there is no second mouse chord to move it
   * to — so it carries a boolean setting instead, and the settings screen
   * renders a switch where it would otherwise render a key capture.
   */
  gesture?: true;
  /**
   * The `Settings` key holding the on/off state. Only for `gesture` entries,
   * and only for those that can be switched off — a gesture without one is
   * listed for discoverability and rendered read-only.
   */
  settingKey?: string;
  /**
   * Bound in code rather than through the registry, so it cannot be rebound.
   *
   * Listed anyway: the panel is where a user looks to find out what keys do,
   * and a key that works but is not listed is indistinguishable from one that
   * does not exist. The settings page renders these without a capture control.
   */
  fixed?: true;
  /**
   * Further combos (or gesture labels) that trigger the same action, always
   * fixed. Shown after the main combo as "or …". `mod+/` is rebindable while
   * Discord's `ctrl+shift+/` always works, and both belong on the same row.
   */
  altKeys?: string[];
}

export const KEYBIND_DEFINITIONS: KeybindDefinition[] = [
  // ── Messages ─────────────────────────────────────────────
  {
    id: 'edit-message',
    description: 'Edit Message',
    category: KeybindCategory.Messages,
    defaultKeys: 'e',
  },
  {
    id: 'delete-message',
    description: 'Delete Message',
    category: KeybindCategory.Messages,
    defaultKeys: 'backspace',
  },
  {
    id: 'pin-message',
    description: 'Pin Message',
    category: KeybindCategory.Messages,
    defaultKeys: 'p',
  },
  {
    id: 'add-reaction',
    description: 'Add Reaction',
    category: KeybindCategory.Messages,
    // Written as the `add` alias with Shift optional. A bare `+` parses as an
    // empty combo and never matched anything, and on most layouts `+` is typed
    // as Shift+= while a numpad sends it unshifted; `shift?` accepts both.
    defaultKeys: 'shift?+add',
  },
  {
    id: 'reply-message',
    description: 'Reply',
    category: KeybindCategory.Messages,
    defaultKeys: 'r',
  },
  {
    id: 'reply-double-click',
    description: 'Reply (double-click a message)',
    category: KeybindCategory.Messages,
    defaultKeys: 'Double-click',
    gesture: true,
    settingKey: 'replyOnDoubleClick',
  },
  {
    id: 'forward-message',
    description: 'Forward Message',
    category: KeybindCategory.Messages,
    defaultKeys: 'f',
  },
  {
    id: 'copy-text',
    description: 'Copy Text',
    category: KeybindCategory.Messages,
    defaultKeys: 'mod+c',
  },
  {
    id: 'mark-unread',
    description: 'Mark Unread',
    category: KeybindCategory.Messages,
    defaultKeys: 'alt+enter',
  },
  {
    id: 'focus-textarea',
    description: 'Focus text area',
    category: KeybindCategory.Messages,
    defaultKeys: 'escape',
  },
  {
    id: 'delete-last-message',
    description: 'Delete your latest message (no confirmation, no reason)',
    category: KeybindCategory.Messages,
    defaultKeys: 'delete',
  },
  {
    id: 'shift-toolbar',
    description: 'Show every action for the hovered message',
    category: KeybindCategory.Messages,
    defaultKeys: 'Hold Shift',
    gesture: true,
  },
  {
    id: 'delete-message-now',
    description: 'Delete Message Now — skip the reason prompt (Shift toolbar)',
    category: KeybindCategory.Messages,
    defaultKeys: `${MOD_LABEL}+Click Delete`,
    gesture: true,
  },

  // ── Navigation ───────────────────────────────────────────
  {
    id: 'quick-switcher',
    description: 'Toggle QuickSwitcher',
    category: KeybindCategory.Navigation,
    defaultKeys: 'mod+k',
  },
  {
    id: 'nav-servers-up',
    description: 'Navigate to previous server',
    category: KeybindCategory.Navigation,
    defaultKeys: 'mod+alt+up',
  },
  {
    id: 'nav-servers-down',
    description: 'Navigate to next server',
    category: KeybindCategory.Navigation,
    defaultKeys: 'mod+alt+down',
  },
  {
    id: 'nav-channels-up',
    description: 'Navigate to previous channel',
    category: KeybindCategory.Navigation,
    defaultKeys: 'alt+up',
  },
  {
    id: 'nav-channels-down',
    description: 'Navigate to next channel',
    category: KeybindCategory.Navigation,
    defaultKeys: 'alt+down',
  },
  {
    id: 'nav-history-back',
    description: 'Navigate back in page history',
    category: KeybindCategory.Navigation,
    defaultKeys: 'alt+left',
  },
  {
    id: 'nav-history-forward',
    description: 'Navigate forward in page history',
    category: KeybindCategory.Navigation,
    defaultKeys: 'alt+right',
  },
  {
    id: 'nav-unread-up',
    description: 'Navigate to previous unread channel',
    category: KeybindCategory.Navigation,
    defaultKeys: 'alt+shift+up',
  },
  {
    id: 'nav-unread-down',
    description: 'Navigate to next unread channel',
    category: KeybindCategory.Navigation,
    defaultKeys: 'alt+shift+down',
  },
  {
    id: 'nav-unread-mentions-up',
    description: 'Navigate to previous unread mention',
    category: KeybindCategory.Navigation,
    defaultKeys: 'mod+shift+alt+up',
  },
  {
    id: 'nav-unread-mentions-down',
    description: 'Navigate to next unread mention',
    category: KeybindCategory.Navigation,
    defaultKeys: 'mod+shift+alt+down',
  },

  // ── Formatting ───────────────────────────────────────────
  {
    id: 'format-bold',
    description: 'Bold',
    category: KeybindCategory.Formatting,
    defaultKeys: 'mod+b',
  },
  {
    id: 'format-italic',
    description: 'Italic',
    category: KeybindCategory.Formatting,
    defaultKeys: 'mod+i',
  },
  {
    id: 'format-underline',
    description: 'Underline',
    category: KeybindCategory.Formatting,
    defaultKeys: 'mod+u',
  },
  {
    id: 'format-strikethrough',
    description: 'Strikethrough',
    category: KeybindCategory.Formatting,
    defaultKeys: 'mod+s',
  },
  {
    id: 'format-inline-code',
    description: 'Inline Code',
    category: KeybindCategory.Formatting,
    defaultKeys: 'mod+[',
  },
  {
    id: 'format-spoiler',
    description: 'Spoiler',
    category: KeybindCategory.Formatting,
    defaultKeys: 'mod+h',
  },
  {
    id: 'format-ordered-list',
    description: 'Ordered List',
    category: KeybindCategory.Formatting,
    defaultKeys: 'mod+7',
  },
  {
    id: 'format-unordered-list',
    description: 'Unordered List',
    category: KeybindCategory.Formatting,
    defaultKeys: 'mod+8',
  },
  {
    id: 'format-block-quote',
    description: 'Block Quote',
    category: KeybindCategory.Formatting,
    defaultKeys: "mod+'",
  },
  {
    id: 'format-code-block',
    description: 'Code Block',
    category: KeybindCategory.Formatting,
    defaultKeys: 'mod+;',
  },
  {
    id: 'format-heading-1',
    description: 'Heading 1',
    category: KeybindCategory.Formatting,
    defaultKeys: 'mod+1',
  },
  {
    id: 'format-heading-2',
    description: 'Heading 2',
    category: KeybindCategory.Formatting,
    defaultKeys: 'mod+2',
  },
  {
    id: 'format-heading-3',
    description: 'Heading 3',
    category: KeybindCategory.Formatting,
    defaultKeys: 'mod+3',
  },
  {
    id: 'format-clear',
    description: 'Clear formatting',
    category: KeybindCategory.Formatting,
    defaultKeys: 'mod+e',
    altKeys: ['escape'],
  },
  {
    id: 'format-exit-block',
    description: 'Leave a heading, list, quote or code block (at its start)',
    category: KeybindCategory.Formatting,
    defaultKeys: 'backspace',
    fixed: true,
  },

  // ── Chat ─────────────────────────────────────────────────
  {
    id: 'mark-server-read',
    description: 'Mark server as read',
    category: KeybindCategory.Chat,
    defaultKeys: 'shift+escape',
  },
  {
    id: 'mark-channel-read',
    description: 'Mark channel as read',
    category: KeybindCategory.Chat,
    // The rebindable key is `alt+shift+r`, but plain Escape also marks the
    // open room read — wired in `Room.tsx` for Discord parity, and it stays
    // there because Escape is shared with focus-textarea and overlay-close.
    defaultKeys: 'alt+shift+r',
    altKeys: ['escape'],
  },
  {
    id: 'toggle-member-list',
    description: 'Toggle member list',
    category: KeybindCategory.Chat,
    // Previously `mod+u` which collided with format-underline. Moved to
    // `mod+shift+m` (M for Members) so the formatting key stays intact.
    defaultKeys: 'mod+shift+m',
  },
  {
    id: 'toggle-emoji-picker',
    description: 'Toggle emoji picker',
    category: KeybindCategory.Chat,
    // Previously `mod+e` which collided with format-clear. Moved to
    // `mod+shift+e` so the formatting key keeps `mod+e`.
    defaultKeys: 'mod+shift+e',
  },
  {
    id: 'scroll-chat-up',
    description: 'Scroll chat up',
    category: KeybindCategory.Chat,
    defaultKeys: 'pageup',
  },
  {
    id: 'scroll-chat-down',
    description: 'Scroll chat down',
    category: KeybindCategory.Chat,
    defaultKeys: 'pagedown',
  },
  {
    id: 'jump-oldest-unread',
    description: 'Jump to oldest unread',
    category: KeybindCategory.Chat,
    defaultKeys: 'shift+pageup',
  },
  {
    id: 'upload-file',
    description: 'Upload a file',
    category: KeybindCategory.Chat,
    defaultKeys: 'mod+shift+u',
  },

  // ── Input ────────────────────────────────────────────────
  {
    id: 'send-message',
    description: 'Send message / save edit',
    category: KeybindCategory.Input,
    defaultKeys: 'mod+enter',
  },
  {
    id: 'send-enter',
    description: 'Send message / save edit (unless "Enter for newline" is on)',
    category: KeybindCategory.Input,
    defaultKeys: 'enter',
    fixed: true,
  },
  {
    id: 'newline',
    description: 'New line',
    category: KeybindCategory.Input,
    defaultKeys: 'shift+enter',
    fixed: true,
  },
  {
    id: 'cancel-reply',
    description: 'Close autocomplete, then cancel the reply',
    category: KeybindCategory.Input,
    defaultKeys: 'escape',
    fixed: true,
  },
  {
    id: 'cancel-edit',
    description: 'Cancel editing a message',
    category: KeybindCategory.Input,
    defaultKeys: 'escape',
    fixed: true,
  },
  {
    id: 'autocomplete-accept',
    description: 'Accept the highlighted autocomplete suggestion',
    category: KeybindCategory.Input,
    defaultKeys: 'tab',
    altKeys: ['enter'],
    fixed: true,
  },
  {
    id: 'focus-textarea-paste',
    description: 'Focus text area and paste',
    category: KeybindCategory.Input,
    defaultKeys: 'mod+v',
    fixed: true,
  },
  {
    id: 'focus-textarea-type',
    description: 'Focus text area (start typing)',
    category: KeybindCategory.Input,
    defaultKeys: 'Any character',
    gesture: true,
  },
  {
    id: 'indent',
    description: 'Indent (code editor)',
    category: KeybindCategory.Input,
    defaultKeys: 'tab',
  },
  {
    id: 'unindent',
    description: 'Unindent (code editor)',
    category: KeybindCategory.Input,
    defaultKeys: 'shift+tab',
  },
  {
    id: 'code-line-below',
    description: 'Insert a line below (code editor)',
    category: KeybindCategory.Input,
    defaultKeys: 'mod+enter',
    fixed: true,
  },
  {
    id: 'code-line-above',
    description: 'Insert a line above (code editor)',
    category: KeybindCategory.Input,
    defaultKeys: 'mod+shift+enter',
    fixed: true,
  },
  {
    id: 'edit-last-message',
    description: 'Edit last message (empty text area)',
    category: KeybindCategory.Input,
    defaultKeys: 'up',
  },

  // ── Misc ─────────────────────────────────────────────────
  {
    id: 'keyboard-shortcuts',
    description: 'Keyboard shortcuts',
    category: KeybindCategory.Navigation,
    defaultKeys: 'mod+/',
    // Discord's Ctrl+? — fixed in GlobalKeybinds so it survives any rebind.
    altKeys: ['ctrl+shift+/'],
  },

  // ── Call ─────────────────────────────────────────────────
  // These only fire while an Element Call embed is active (gated by
  // `useCallEmbed()` in the binding component). Defaults follow the
  // Discord convention of Mod+Shift+<letter>.
  {
    id: 'call-toggle-microphone',
    description: 'Toggle microphone (in-call)',
    category: KeybindCategory.Call,
    defaultKeys: 'mod+shift+a',
  },
  {
    id: 'call-toggle-video',
    description: 'Toggle camera (in-call)',
    category: KeybindCategory.Call,
    defaultKeys: 'mod+shift+v',
  },
  {
    id: 'call-toggle-screenshare',
    description: 'Toggle screenshare (in-call)',
    category: KeybindCategory.Call,
    defaultKeys: 'mod+shift+s',
  },
  {
    id: 'call-toggle-sound',
    description: 'Toggle outgoing audio (in-call)',
    category: KeybindCategory.Call,
    defaultKeys: 'mod+shift+d',
  },
  {
    id: 'call-hangup',
    description: 'Leave the call',
    category: KeybindCategory.Call,
    defaultKeys: 'mod+shift+h',
  },

  // ── Media Viewer ─────────────────────────────────────────
  // The gallery feed's keys are fixed in `MediaFeed.tsx`: the viewer is a
  // modal with its own focus trap, and its keys mirror a video player's.
  {
    id: 'gallery-close',
    description: 'Close the media viewer',
    category: KeybindCategory.MediaViewer,
    defaultKeys: 'escape',
    fixed: true,
  },
  {
    id: 'gallery-next',
    description: 'Next item',
    category: KeybindCategory.MediaViewer,
    defaultKeys: 'down',
    altKeys: ['pagedown', 'j', 'space'],
    fixed: true,
  },
  {
    id: 'gallery-prev',
    description: 'Previous item',
    category: KeybindCategory.MediaViewer,
    defaultKeys: 'up',
    altKeys: ['pageup', 'k'],
    fixed: true,
  },
  {
    id: 'gallery-mute',
    description: 'Toggle mute',
    category: KeybindCategory.MediaViewer,
    defaultKeys: 'm',
    fixed: true,
  },

  // ── Emoji Picker ─────────────────────────────────────────
  // Fixed in `EmojiBoard.tsx`; they act while the search box has focus.
  {
    id: 'picker-move',
    description: 'Move the highlight',
    category: KeybindCategory.EmojiPicker,
    defaultKeys: 'up',
    altKeys: ['down', 'left', 'right'],
    fixed: true,
  },
  {
    id: 'picker-select',
    description: 'Pick the highlighted emoji (or send typed text as a reaction)',
    category: KeybindCategory.EmojiPicker,
    defaultKeys: 'enter',
    fixed: true,
  },
  {
    id: 'picker-select-keep-open',
    description: 'Pick and keep the picker open',
    category: KeybindCategory.EmojiPicker,
    defaultKeys: 'shift+enter',
    altKeys: ['alt+enter'],
    fixed: true,
  },
  {
    id: 'picker-click-keep-open',
    description: 'Pick and keep the picker open',
    category: KeybindCategory.EmojiPicker,
    defaultKeys: 'Shift+Click',
    altKeys: ['Alt+Click'],
    gesture: true,
  },
];

const KEYBIND_MAP = new Map<string, KeybindDefinition>();
for (const def of KEYBIND_DEFINITIONS) {
  KEYBIND_MAP.set(def.id, def);
}

export function getKeybindDefinition(id: string): KeybindDefinition | undefined {
  return KEYBIND_MAP.get(id);
}

export function getCurrentKey(id: string, overrides: Record<string, string>): string {
  return overrides[id] ?? getKeybindDefinition(id)?.defaultKeys ?? id;
}

export const DEFAULT_KEYBINDS: Record<string, string> = {};
for (const def of KEYBIND_DEFINITIONS) {
  DEFAULT_KEYBINDS[def.id] = def.defaultKeys;
}

export const keyboardShortcutsAtom = atom<boolean>(false);
