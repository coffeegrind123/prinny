import { describe, expect, it } from 'vitest';
import { Descendant, Editor, Node, Transforms, createEditor } from 'slate';
import { withHistory } from 'slate-history';
import { insertQuotedLines } from './utils';
import { BlockType } from './types';

// vitest, node environment: slate's core runs without a DOM. Run with: npm test

const para = (text: string): Descendant =>
  ({ type: BlockType.Paragraph, children: [{ text }] }) as Descendant;

const makeEditor = (lines: string[], caret?: { line: number; offset: number }): Editor => {
  const editor = withHistory(createEditor());
  editor.children = lines.map(para);
  const line = caret?.line ?? lines.length - 1;
  const offset = caret?.offset ?? lines[line].length;
  Transforms.select(editor, { path: [line, 0], offset });
  return editor;
};

const text = (editor: Editor): string => editor.children.map((n) => Node.string(n)).join('\n');

describe('insertQuotedLines (pasting into a "> " quote line)', () => {
  it('quotes every pasted line, not just the first', () => {
    // Measured live: "> " then pasting three lines sent
    // <blockquote>first line</blockquote>second line<br/>third line.
    const editor = makeEditor(['> ']);
    expect(insertQuotedLines(editor, 'first line\nsecond line\nthird line')).toBe(true);
    expect(text(editor)).toBe('> first line\n> second line\n> third line');
  });

  it('keeps the marker as typed, including nested quotes and no space', () => {
    const nested = makeEditor(['> > ']);
    insertQuotedLines(nested, 'a\nb');
    expect(text(nested)).toBe('> > a\n> > b');

    const tight = makeEditor(['>']);
    insertQuotedLines(tight, 'a\nb');
    expect(text(tight)).toBe('>a\n>b');
  });

  it('quotes blank pasted lines too, so the quote stays one block', () => {
    const editor = makeEditor(['> ']);
    insertQuotedLines(editor, 'a\n\nb');
    expect(text(editor)).toBe('> a\n> \n> b');
  });

  it('handles CRLF and a caret in the middle of the quote line', () => {
    const editor = makeEditor(['> abcd'], { line: 0, offset: 4 });
    insertQuotedLines(editor, 'x\r\ny');
    expect(text(editor)).toBe('> abx\n> ycd');
  });

  it('replaces a selection inside the quote line', () => {
    const editor = makeEditor(['> old text']);
    Transforms.select(editor, {
      anchor: { path: [0, 0], offset: 2 },
      focus: { path: [0, 0], offset: 10 },
    });
    insertQuotedLines(editor, 'new\nlines');
    expect(text(editor)).toBe('> new\n> lines');
  });

  it('only touches the line the caret is on', () => {
    const editor = makeEditor(['> quoted', 'plain '], { line: 1, offset: 6 });
    expect(insertQuotedLines(editor, 'a\nb')).toBe(false);
    expect(text(editor)).toBe('> quoted\nplain ');
  });

  it('leaves single-line pastes and unquoted lines to the default paste', () => {
    const single = makeEditor(['> ']);
    expect(insertQuotedLines(single, 'just one line')).toBe(false);
    expect(text(single)).toBe('> ');

    const plain = makeEditor(['hello ']);
    expect(insertQuotedLines(plain, 'a\nb')).toBe(false);
    expect(text(plain)).toBe('hello ');
  });

  it('leaves a Discord ">>> " quote alone, since it already quotes the rest of the message', () => {
    const editor = makeEditor(['>>> ']);
    expect(insertQuotedLines(editor, 'a\nb')).toBe(false);
    expect(text(editor)).toBe('>>> ');
  });

  it('leaves code blocks alone', () => {
    const editor = withHistory(createEditor());
    editor.children = [
      {
        type: BlockType.CodeBlock,
        children: [{ type: BlockType.CodeLine, children: [{ text: '> ' }] }],
      } as Descendant,
    ];
    Transforms.select(editor, { path: [0, 0, 0], offset: 2 });
    expect(insertQuotedLines(editor, 'a\nb')).toBe(false);
  });
});
