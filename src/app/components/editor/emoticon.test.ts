import { describe, expect, it } from 'vitest';
import { Descendant } from 'slate';
import { toMatrixCustomHTML } from './output';
import { htmlToEditorInput } from './input';
import { createEmoticonElement } from './utils';
import { BlockType } from './types';

const paragraph = (alt?: string): Descendant[] => [
  {
    type: BlockType.Paragraph,
    children: [
      { text: '' },
      createEmoticonElement('mxc://example.org/cat', 'cat_wave', alt),
      { text: '' },
    ],
  } as Descendant,
];

const findEmoticon = (nodes: Descendant[]): Record<string, unknown> | undefined => {
  for (const node of nodes as unknown as Record<string, unknown>[]) {
    if (node.type === BlockType.Emoticon) return node;
    if (Array.isArray(node.children)) {
      const found = findEmoticon(node.children as Descendant[]);
      if (found) return found;
    }
  }
  return undefined;
};

describe('custom emoji markup (Matrix v1.19 image packs)', () => {
  it('sends the description as alt and the shortcode as title', () => {
    const html = toMatrixCustomHTML(paragraph('a waving cat'), {});
    expect(html).toContain('alt="a waving cat"');
    expect(html).toContain('title="cat_wave"');
    expect(html).toContain('height="32"');
  });

  it('falls back to the shortcode for alt', () => {
    const html = toMatrixCustomHTML(paragraph(), {});
    expect(html).toContain('alt="cat_wave"');
  });

  it('reads the shortcode back from title when editing', () => {
    const html = toMatrixCustomHTML(paragraph('a waving cat'), {});
    const node = findEmoticon(htmlToEditorInput(html));
    expect(node).toMatchObject({ shortcode: 'cat_wave', alt: 'a waving cat' });
    expect(toMatrixCustomHTML(htmlToEditorInput(html), {})).toBe(html);
  });

  it('still reads older messages that only have alt', () => {
    const node = findEmoticon(
      htmlToEditorInput(
        '<img data-mx-emoticon src="mxc://example.org/cat" alt="cat_wave" height="32">',
      ),
    );
    expect(node).toMatchObject({ shortcode: 'cat_wave' });
    expect(node?.alt).toBeUndefined();
  });
});
