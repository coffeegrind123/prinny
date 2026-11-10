import { beforeEach, describe, expect, it } from 'vitest';
import type { Descendant } from 'slate';
import { loadMsgDraft, storeMsgDraft, MSG_DRAFTS_KEY } from './msgDraftStore';

const memoryStorage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, String(value));
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => data.clear(),
    key: (i: number) => Array.from(data.keys())[i] ?? null,
    get length() {
      return data.size;
    },
  } as Storage;
};

const draft = (text: string): Descendant[] =>
  [{ type: 'paragraph', children: [{ text }] }] as unknown as Descendant[];

beforeEach(() => {
  globalThis.localStorage = memoryStorage();
});

describe('msgDraftStore', () => {
  it('returns an empty draft for a room with nothing stored', () => {
    expect(loadMsgDraft('!a:hs')).toEqual([]);
  });

  it('stores and loads a draft per scope, threads separate from their room', () => {
    storeMsgDraft('!a:hs', draft('room text'));
    storeMsgDraft('!a:hs|thread:$t', draft('thread text'));
    expect(loadMsgDraft('!a:hs')).toEqual(draft('room text'));
    expect(loadMsgDraft('!a:hs|thread:$t')).toEqual(draft('thread text'));
    expect(loadMsgDraft('!b:hs')).toEqual([]);
  });

  it('removes the entry when the draft becomes empty, and the key once nothing is left', () => {
    storeMsgDraft('!a:hs', draft('x'));
    storeMsgDraft('!b:hs', draft('y'));
    storeMsgDraft('!a:hs', []);
    expect(loadMsgDraft('!a:hs')).toEqual([]);
    expect(loadMsgDraft('!b:hs')).toEqual(draft('y'));
    storeMsgDraft('!b:hs', []);
    expect(localStorage.getItem(MSG_DRAFTS_KEY)).toBeNull();
  });

  it('ignores stored data of the wrong shape instead of handing it to the editor', () => {
    localStorage.setItem(MSG_DRAFTS_KEY, 'not json');
    expect(loadMsgDraft('!a:hs')).toEqual([]);
    localStorage.setItem(MSG_DRAFTS_KEY, JSON.stringify(['x']));
    expect(loadMsgDraft('!a:hs')).toEqual([]);
    localStorage.setItem(
      MSG_DRAFTS_KEY,
      JSON.stringify({ '!a:hs': 'text', '!b:hs': [1, 2], '!c:hs': draft('ok') }),
    );
    expect(loadMsgDraft('!a:hs')).toEqual([]);
    expect(loadMsgDraft('!b:hs')).toEqual([]);
    expect(loadMsgDraft('!c:hs')).toEqual(draft('ok'));
  });

  it('keeps working when storage refuses to write', () => {
    globalThis.localStorage = {
      ...memoryStorage(),
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
    } as Storage;
    expect(() => storeMsgDraft('!a:hs', draft('x'))).not.toThrow();
  });
});
