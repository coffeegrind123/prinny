import { BasePoint, BaseRange, Editor, Element, Point, Range, Text, Transforms } from 'slate';
import { ReactEditor } from 'slate-react';
import { BlockType, MarkType } from './types';
import {
  CommandElement,
  EmoticonElement,
  FormattedText,
  HeadingLevel,
  LinkElement,
  MentionElement,
} from './slate';

const ALL_MARK_TYPE: MarkType[] = [
  MarkType.Bold,
  MarkType.Code,
  MarkType.Italic,
  MarkType.Spoiler,
  MarkType.StrikeThrough,
  MarkType.Underline,
];

export const isMarkActive = (editor: Editor, format: MarkType) => {
  const marks = Editor.marks(editor);
  return marks ? marks[format] === true : false;
};

export const isAnyMarkActive = (editor: Editor) => {
  const marks = Editor.marks(editor);
  return marks && !!ALL_MARK_TYPE.find((type) => marks[type] === true);
};

export const toggleMark = (editor: Editor, format: MarkType) => {
  const isActive = isMarkActive(editor, format);

  if (isActive) {
    Editor.removeMark(editor, format);
  } else {
    Editor.addMark(editor, format, true);
  }
};

export const removeAllMark = (editor: Editor) => {
  ALL_MARK_TYPE.forEach((mark) => {
    if (isMarkActive(editor, mark)) Editor.removeMark(editor, mark);
  });
};

export const isBlockActive = (editor: Editor, format: BlockType) => {
  const [match] = Editor.nodes(editor, {
    match: (node) => Element.isElement(node) && node.type === format,
  });

  return !!match;
};

export const headingLevel = (editor: Editor): HeadingLevel | undefined => {
  const [nodeEntry] = Editor.nodes(editor, {
    match: (node) => Element.isElement(node) && node.type === BlockType.Heading,
  });
  const [node] = nodeEntry ?? [];
  if (!node) return undefined;
  if ('level' in node) return node.level;
  return undefined;
};

type BlockOption = { level: HeadingLevel };
const NESTED_BLOCK = [
  BlockType.OrderedList,
  BlockType.UnorderedList,
  BlockType.BlockQuote,
  BlockType.CodeBlock,
];

export const toggleBlock = (editor: Editor, format: BlockType, option?: BlockOption) => {
  Transforms.collapse(editor, {
    edge: 'end',
  });
  const isActive = isBlockActive(editor, format);

  Transforms.unwrapNodes(editor, {
    match: (node) => Element.isElement(node) && NESTED_BLOCK.includes(node.type),
    split: true,
  });

  if (isActive) {
    Transforms.setNodes(editor, {
      type: BlockType.Paragraph,
    });
    return;
  }

  if (format === BlockType.OrderedList || format === BlockType.UnorderedList) {
    Transforms.setNodes(editor, {
      type: BlockType.ListItem,
    });
    const block = {
      type: format,
      children: [],
    };
    Transforms.wrapNodes(editor, block);
    return;
  }
  if (format === BlockType.CodeBlock) {
    Transforms.setNodes(editor, {
      type: BlockType.CodeLine,
    });
    const block = {
      type: format,
      children: [],
    };
    Transforms.wrapNodes(editor, block);
    return;
  }

  if (format === BlockType.BlockQuote) {
    Transforms.setNodes(editor, {
      type: BlockType.QuoteLine,
    });
    const block = {
      type: format,
      children: [],
    };
    Transforms.wrapNodes(editor, block);
    return;
  }

  if (format === BlockType.Heading) {
    Transforms.setNodes(editor, {
      type: format,
      level: option?.level ?? 1,
    });
  }

  Transforms.setNodes(editor, {
    type: format,
  });
};

export const resetEditor = (editor: Editor) => {
  Transforms.delete(editor, {
    at: {
      anchor: Editor.start(editor, []),
      focus: Editor.end(editor, []),
    },
  });

  toggleBlock(editor, BlockType.Paragraph);
  removeAllMark(editor);
};

export const resetEditorHistory = (editor: Editor) => {
  // eslint-disable-next-line no-param-reassign
  editor.history = {
    undos: [],
    redos: [],
  };
};

export const createMentionElement = (
  id: string,
  name: string,
  highlight: boolean,
  eventId?: string,
  viaServers?: string[],
): MentionElement => ({
  type: BlockType.Mention,
  id,
  eventId,
  viaServers,
  highlight,
  name,
  children: [{ text: '' }],
});

export const createEmoticonElement = (key: string, shortcode: string): EmoticonElement => ({
  type: BlockType.Emoticon,
  key,
  shortcode,
  children: [{ text: '' }],
});

export const createLinkElement = (
  href: string,
  children: string | FormattedText[],
): LinkElement => ({
  type: BlockType.Link,
  href,
  children: typeof children === 'string' ? [{ text: children }] : children,
});

export const createCommandElement = (command: string): CommandElement => ({
  type: BlockType.Command,
  command,
  children: [{ text: '' }],
});

export const replaceWithElement = (editor: Editor, selectRange: BaseRange, element: Element) => {
  Transforms.select(editor, selectRange);
  Transforms.insertNodes(editor, element);
  Transforms.collapse(editor, {
    edge: 'end',
  });
};

export const moveCursor = (editor: Editor, withSpace?: boolean) => {
  Transforms.move(editor);
  if (withSpace) editor.insertText(' ');
};

/**
 * Put a caret back when the editor has lost its selection.
 *
 * `editor.selection` is the whole of what Slate edits against: with none,
 * `insertText` is a no-op, and the browser — which is still perfectly happy to
 * type into a focused contenteditable — paints the characters anyway. Model and
 * screen then disagree until the next render from the model reconciles them,
 * and what the reader sees is their words rearranged. Measured in Chromium
 * against this editor's own config: focused composer holding "hello ", selection
 * cleared, type "abc" — the result is "abchello".
 *
 * The end of the document, because every caller reaches this having just
 * inserted something at the cursor and being about to carry on after it.
 * Returns whether a caret was actually restored.
 */
export const restoreCaretIfMissing = (editor: Editor): boolean => {
  if (editor.selection) return false;
  try {
    Transforms.select(editor, Editor.end(editor, []));
    return true;
  } catch {
    // Empty or detached tree — there is no valid point to select.
    return false;
  }
};

/**
 * Focus the slate editor without crashing when the recorded selection
 * no longer matches the DOM tree. ReactEditor.focus uses
 * `toDOMRange(editor.selection)` internally; if the selection points at
 * a text node that was just removed (e.g. an autocomplete trigger like
 * `:emoji:` that was replaced with an emoticon element, or a focus
 * restore that fires after the edit-message dialog re-renders), that
 * call throws "Cannot resolve a DOM node from Slate node" and the whole
 * tree crashes to the React Router error boundary.
 *
 * The recovery is to deselect first so ReactEditor.focus skips the
 * range restore, then focus the editor DOM node directly. If even that
 * fails the slate tree has been detached entirely (component
 * unmounting) — silently bail.
 *
 * Afterwards the caret MUST be put back. Slate drives every edit off
 * `editor.selection`; leaving the editor focused with a null selection
 * means each keystroke has to re-derive one from the DOM instead of
 * continuing from the model, and characters end up landing at the same
 * anchor repeatedly — which reads as text being typed in backwards.
 * That is not hypothetical: the throwing branch above fires exactly when
 * an emoticon element has just replaced the text node the selection
 * pointed at, so picking an emoji and closing the board (which calls
 * this) left the composer in precisely that state.
 */
export const safeFocusEditor = (editor: Editor) => {
  // Before focusing, not after: `ReactEditor.focus` cannot be relied on to put
  // a caret back, and it is a no-op in exactly the case that needs one most.
  // Reading slate-dom's `focus()` — it returns immediately when slate already
  // believes the editor is focused, and again when the DOM node is already the
  // active element. Both returns skip its own "create a new selection in the
  // top of the document if missing" branch, so a composer that kept focus while
  // its selection was cleared stays selection-less, and the caller that asked
  // for a caret gets none. Verified in a browser against this editor: with the
  // composer focused and `editor.selection` null, `safeFocusEditor` returned
  // with it still null, and typing "abc" after "hello " produced "abchello".
  //
  // That branch would also be the wrong repair here even when it does run: it
  // selects `Editor.start`, so words typed after picking an emoji would land
  // before it. Every caller of this reaches it having just inserted at the
  // cursor, so the end of the document is where the caret was heading.
  restoreCaretIfMissing(editor);

  try {
    ReactEditor.focus(editor as ReactEditor);
    return;
  } catch {
    // fall through to deselect + DOM focus
  }
  try {
    Transforms.deselect(editor);
  } catch {
    // already detached
  }
  try {
    const el = ReactEditor.toDOMNode(editor as ReactEditor, editor);
    el.focus({ preventScroll: true });
  } catch {
    // editor DOM node is gone — nothing more we can do
    return;
  }
  // The deselect above threw the caret away deliberately; put it back.
  restoreCaretIfMissing(editor);
};

interface PointUntilCharOptions {
  match: (char: string) => boolean;
  reverse?: boolean;
}
export const getPointUntilChar = (
  editor: Editor,
  cursorPoint: BasePoint,
  options: PointUntilCharOptions,
): BasePoint | undefined => {
  let targetPoint: BasePoint | undefined;
  let prevPoint: BasePoint | undefined;
  let char: string | undefined;

  const pointItr = Editor.positions(editor, {
    at: {
      anchor: Editor.start(editor, []),
      focus: Editor.point(editor, cursorPoint, { edge: 'start' }),
    },
    unit: 'character',
    reverse: options.reverse,
  });

  // eslint-disable-next-line no-restricted-syntax
  for (const point of pointItr) {
    if (!Point.equals(point, cursorPoint) && prevPoint) {
      char = Editor.string(editor, { anchor: point, focus: prevPoint });

      if (options.match(char)) break;
      targetPoint = point;
    }
    prevPoint = point;
  }
  return targetPoint;
};

export const getPrevWorldRange = (editor: Editor): BaseRange | undefined => {
  const { selection } = editor;
  if (!selection || !Range.isCollapsed(selection)) return undefined;
  const [cursorPoint] = Range.edges(selection);
  const worldStartPoint = getPointUntilChar(editor, cursorPoint, {
    reverse: true,
    match: (char) => char === ' ',
  });
  return worldStartPoint && Editor.range(editor, worldStartPoint, cursorPoint);
};

export const isEmptyEditor = (editor: Editor): boolean => {
  const firstChildren = editor.children[0];
  if (firstChildren && Element.isElement(firstChildren)) {
    const isEmpty = editor.children.length === 1 && Editor.isEmpty(editor, firstChildren);
    return isEmpty;
  }
  return false;
};

/**
 * A command typed as ordinary text, e.g. `/shrug hello`.
 *
 * Anchored, and the name is letters/digits/`-`/`_` only, so `//shrug` does not
 * match and sends literally — the usual escape. A trailing space or end of line
 * is required so `/notacommand...` is not read as a name with punctuation glued
 * to it.
 */
const PLAIN_COMMAND_PATTERN = /^\/([a-zA-Z0-9_-]+)(?:\s|$)/;

/**
 * The command this message begins with, whether or not the autocomplete built a
 * node for it.
 *
 * The popup inserts a real `BlockType.Command` inline element, and until now
 * that element was the ONLY thing this looked for — so a command that was typed
 * out and sent without ever touching the popup was not a command at all. It
 * went to the room as the literal text `/shrug hello`. Nothing announced that;
 * the message simply came out wrong, which is why it read as the popup being
 * required rather than as commands being half-implemented.
 *
 * The plain-text branch is the same idea as `emojiShortcodeReplace` doing
 * `:sob:` without its autocomplete, except that it needs no setting to be safe:
 * a leading slash is unambiguous where a `:word:` in prose is not.
 *
 * It stays deliberately permissive about the NAME. Resolving which names are
 * real is the caller's job and it already does it — RoomInput only trims and
 * executes when the name is a built-in, and anything else is left as text for a
 * bot in the room to parse, exactly as before.
 */
export const getBeginCommand = (editor: Editor): string | undefined => {
  const lineBlock = editor.children[0];
  if (!Element.isElement(lineBlock)) return undefined;
  if (lineBlock.type !== BlockType.Paragraph) return undefined;

  const [firstInline, secondInline] = lineBlock.children;
  const isEmptyText = Text.isText(firstInline) && firstInline.text.trim() === '';

  if (isEmptyText) {
    if (Element.isElement(secondInline) && secondInline.type === BlockType.Command)
      return secondInline.command;
    return undefined;
  }

  if (Text.isText(firstInline)) {
    return firstInline.text.match(PLAIN_COMMAND_PATTERN)?.[1];
  }
  return undefined;
};

export type EmojiReplacement = {
  key: string;
  shortcode: string;
};

const SHORTCODE_PATTERN = /:([a-zA-Z0-9_+-]+):$/;

/**
 * Checks if the text immediately before the cursor forms a `:shortcode:`
 * pattern and, if the shortcode is found in the provided map, replaces
 * that text range with an inline EmoticonElement.
 *
 * Returns true when a replacement was made.
 */
export const replaceShortcodeWithEmoji = (
  editor: Editor,
  emojiMap: Map<string, EmojiReplacement>,
): boolean => {
  const { selection } = editor;
  if (!selection || !Range.isCollapsed(selection)) return false;

  const [cursor] = Range.edges(selection);

  // Skip when inside a code block or inline code
  const codeBlockEntry = Editor.above(editor, {
    at: cursor,
    match: (n) => Element.isElement(n) && n.type === BlockType.CodeBlock,
  });
  if (codeBlockEntry) return false;

  const marks = Editor.marks(editor);
  if (marks?.code) return false;

  // Get the text node at the cursor
  const [node] = Editor.node(editor, cursor.path);
  if (!Text.isText(node)) return false;

  const text = node.text;
  const offset = cursor.offset;

  // Look for :shortcode: pattern ending at the cursor
  const beforeCursor = text.slice(0, offset);
  const match = beforeCursor.match(SHORTCODE_PATTERN);
  if (!match) return false;

  const shortcode = match[1].toLowerCase();
  const emoji = emojiMap.get(shortcode);
  if (!emoji) return false;

  // Replace the :shortcode: text with an emoticon element
  const startOffset = offset - match[0].length;
  const range: BaseRange = {
    anchor: { path: cursor.path, offset: startOffset },
    focus: { path: cursor.path, offset },
  };

  replaceWithElement(editor, range, createEmoticonElement(emoji.key, emoji.shortcode));
  moveCursor(editor, true);

  return true;
};
