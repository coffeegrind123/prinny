import { Descendant } from 'slate';
import { getLocalStorageItem, setLocalStorageItem } from '../utils/atomWithLocalStorage';

/**
 * Unsent composer text, by draft scope (a room ID, or `roomId|thread:$root`
 * for a thread's composer), kept in localStorage so it survives a reload or a
 * restart. Signing out clears localStorage, these with it.
 *
 * Drafts of encrypted rooms are stored as plaintext on this device, as
 * Element does.
 */
export const MSG_DRAFTS_KEY = 'prinny.messageDrafts';

type StoredDrafts = Record<string, Descendant[]>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Editor content is a list of element nodes; anything else would break Slate. */
const isDraft = (value: unknown): value is Descendant[] =>
  Array.isArray(value) && value.every((node) => isRecord(node) && Array.isArray(node.children));

const readDrafts = (): StoredDrafts => {
  try {
    const stored = getLocalStorageItem<unknown>(MSG_DRAFTS_KEY, undefined);
    return isRecord(stored) ? (stored as StoredDrafts) : {};
  } catch {
    // Storage blocked (private mode, sandboxed frame): no stored drafts.
    return {};
  }
};

export const loadMsgDraft = (scope: string): Descendant[] => {
  const draft = readDrafts()[scope];
  return isDraft(draft) ? draft : [];
};

/** Stores the scope's draft; an empty one removes it. */
export const storeMsgDraft = (scope: string, draft: Descendant[]): void => {
  const drafts = readDrafts();
  if (draft.length === 0) {
    if (!(scope in drafts)) return;
    delete drafts[scope];
  } else {
    drafts[scope] = draft;
  }

  try {
    if (Object.keys(drafts).length === 0) {
      localStorage.removeItem(MSG_DRAFTS_KEY);
    } else {
      setLocalStorageItem(MSG_DRAFTS_KEY, drafts);
    }
  } catch {
    // Storage is full or unavailable: the draft still lives in memory for this session.
  }
};
