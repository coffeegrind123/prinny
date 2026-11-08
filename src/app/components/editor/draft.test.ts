import { describe, expect, it } from 'vitest';
import { Descendant, Editor, Node, createEditor } from 'slate';
import { withHistory } from 'slate-history';
import { applyDraft } from './utils';
import { BlockType } from './types';

// vitest, node environment: slate's core runs without a DOM. Run with: npm test

const para = (text: string): Descendant =>
  ({ type: BlockType.Paragraph, children: [{ text }] }) as Descendant;

const EMPTY: Descendant[] = [para('')];

const makeEditor = (content: Descendant[] = EMPTY): Editor => {
  const editor = withHistory(createEditor());
  editor.children = structuredClone(content);
  return editor;
};

const text = (editor: Editor): string => editor.children.map((n) => Node.string(n)).join('\n');

const URL = 'https://github.com/coffeegrind123/prinny';

describe('applyDraft (composer draft restore)', () => {
  it('restores a saved draft into an empty composer', () => {
    const editor = makeEditor();
    applyDraft(editor, [para(URL)]);
    expect(text(editor)).toBe(URL);
  });

  it('does not duplicate a draft the composer already shows', () => {
    const editor = makeEditor([para(URL)]);
    applyDraft(editor, [para(URL)]);
    expect(text(editor)).toBe(URL);
  });

  /*
   * Crossing the mobile/desktop breakpoint rebuilds the router (App.tsx), so the
   * room's composer remounts. The new RoomInput renders before the old one's
   * unmount cleanup saves the current text, so its first restore sees the
   * previous save (stale), then the cleanup's save arrives as a second update.
   * Each crossing appended both, which is how 39 typed characters became 195.
   */
  it('ends up with the latest draft when a stale one is applied first', () => {
    const editor = makeEditor();
    applyDraft(editor, [para('older text')]);
    applyDraft(editor, [para(URL)]);
    expect(text(editor)).toBe(URL);
  });

  it('clears the composer when the draft becomes empty', () => {
    const editor = makeEditor([para('older text')]);
    applyDraft(editor, []);
    expect(text(editor)).toBe('');
    expect(editor.children).toHaveLength(1);
  });

  it('restores multi-paragraph drafts intact', () => {
    const editor = makeEditor();
    applyDraft(editor, [para('one'), para('two')]);
    expect(text(editor)).toBe('one\ntwo');
  });

  it('leaves nothing to undo back into the replaced text', () => {
    const editor = makeEditor();
    applyDraft(editor, [para('older text')]);
    applyDraft(editor, [para(URL)]);
    expect(editor.history.undos).toHaveLength(0);
  });
});
