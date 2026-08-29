import { BasePoint, BaseRange, Editor, Element, Node, Point, Range, Text, Transforms } from 'slate';
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
 * The last caret each editor is known to have had.
 *
 * Restoring to the end of the document is right when the reader was typing at
 * the end, which is most of the time — and wrong the rest of it. Measured in
 * Chromium: caret put in the middle of "hello", the selection cleared, "XY"
 * typed — without this the result is "helloXY", the reader's words carrying on
 * somewhere they were not looking. A remembered caret puts them back where they
 * were.
 *
 * A WeakMap rather than component state: `restoreCaretIfMissing` is reached
 * from `safeFocusEditor` in a dozen places with no component to hold it, and
 * the entry should die with the editor.
 */
const LAST_SELECTION = new WeakMap<Editor, BaseRange>();

/** Record the editor's caret, if it has one, as the place to come back to. */
export const rememberSelection = (editor: Editor): void => {
  if (editor.selection) LAST_SELECTION.set(editor, editor.selection);
};

/** Whether a remembered range still points at text that exists. */
const rangeStillValid = (editor: Editor, range: BaseRange): boolean =>
  [range.anchor, range.focus].every((point) => {
    if (!Editor.hasPath(editor, point.path)) return false;
    const node = Node.get(editor, point.path);
    return Text.isText(node) && point.offset <= node.text.length;
  });

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

  const remembered = LAST_SELECTION.get(editor);
  if (remembered) {
    try {
      if (rangeStillValid(editor, remembered)) {
        Transforms.select(editor, remembered);
        return true;
      }
    } catch {
      // Fall through to the end of the document.
    }
  }

  try {
    Transforms.select(editor, Editor.end(editor, []));
    return true;
  } catch {
    // Empty or detached tree — there is no valid point to select.
    return false;
  }
};

/**
 * Put a caret back in the BROWSER when the editor is focused and has none.
 *
 * This is the other half of the "text comes out backwards" bug, and the half
 * the model-level repair above cannot reach: there, `editor.selection` is
 * perfectly fine and only the DOM caret is gone, so that guard returns
 * immediately and the message still builds up in reverse.
 *
 * Why a missing DOM caret reverses text, from slate-react's own
 * `onDOMBeforeInput`: for a plain single character (`/[a-z ]/i`) typed at a
 * collapsed selection, slate takes a **native insertion** fast path — it does
 * not `preventDefault`, and lets the browser perform the edit. The browser
 * performs it at the *DOM* selection, which slate never consulted. With no DOM
 * caret the browser puts the character at the START of the contenteditable.
 * Measured in Chromium against this editor: composer holding "hi ", the DOM
 * selection cleared once with the model left alone, then "abcdef" typed — the
 * result is "ahi bcdef". Anything that clears the caret repeatedly — the
 * null-selection state slate's own DOM sync sustains, one wipe per render —
 * does that to every character, and the message reads backwards.
 *
 * Only a *missing* caret is repaired. A real selection is left where it is,
 * including outside the editor: someone highlighting a message to copy it while
 * the composer still holds focus must not have it snatched back.
 *
 * Returns whether a caret was put back.
 */
export const restoreDomCaretIfMissing = (editor: Editor): boolean => {
  let el: HTMLElement;
  try {
    el = ReactEditor.toDOMNode(editor as ReactEditor, editor);
  } catch {
    // Not mounted, or detached mid-unmount.
    return false;
  }

  const root = el.getRootNode();
  const documentOrShadow = root instanceof Document || root instanceof ShadowRoot ? root : null;
  // Only ever repairs the editor the reader is actually typing into.
  if (documentOrShadow?.activeElement !== el) return false;

  // `getSelection` on a ShadowRoot is the shadow-DOM-aware form and is not in
  // every engine's lib types; the owning document's is the fallback either way.
  const shadowGetSelection = (documentOrShadow as { getSelection?: () => Selection | null })
    .getSelection;
  const domSelection = shadowGetSelection
    ? shadowGetSelection.call(documentOrShadow)
    : el.ownerDocument.getSelection();
  if (!domSelection) return false;
  if (domSelection.rangeCount > 0) return false;

  // The model has to have a caret before one can be projected into the DOM.
  restoreCaretIfMissing(editor);
  const { selection } = editor;
  if (!selection) return false;

  try {
    const domRange = ReactEditor.toDOMRange(editor as ReactEditor, selection);
    domSelection.removeAllRanges();
    domSelection.addRange(domRange);
    return true;
  } catch {
    // The selection points at something that is not rendered — nothing to
    // project, and slate's own DOM sync will correct it on the next render.
    return false;
  }
};

/**
 * Focus the editor's DOM node and point the browser's selection at
 * `editor.selection`, skipping if it is already the active element.
 *
 * The same three steps `DOMEditor.focus` takes, minus its bail-outs. Slate's
 * `IS_FOCUSED` is not set here on purpose: `Editable`'s own `onFocus` handler
 * sets it from the focus event this raises, so the React tree learns about it
 * through the same path as a click.
 */
const focusEditorDOM = (editor: Editor): void => {
  const el = ReactEditor.toDOMNode(editor as ReactEditor, editor);
  const root = el.getRootNode();
  const activeElement =
    root instanceof Document || root instanceof ShadowRoot ? root.activeElement : null;
  if (activeElement === el) return;

  const { selection } = editor;
  if (selection) {
    try {
      const domRange = ReactEditor.toDOMRange(editor as ReactEditor, selection);
      const domSelection = (root instanceof Document ? root : el.ownerDocument).getSelection();
      domSelection?.removeAllRanges();
      domSelection?.addRange(domRange);
    } catch {
      // The selection points at a node that is not rendered yet. Focusing
      // without it still beats not focusing: the browser puts a caret in the
      // contenteditable itself, and slate's own DOM sync corrects it on the
      // next render.
    }
  }
  el.focus({ preventScroll: true });
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
    // `ReactEditor.focus` is not reliably synchronous, and the one call above
    // is the case that makes it asynchronous. Reading slate-dom's `focus()`:
    // when `editor.operations.length > 0` it defers itself by a 10ms timeout
    // and returns, because "the DOM (selection) is unstable while changes are
    // applied". `restoreCaretIfMissing` had just applied a `set_selection`
    // operation, and slate does not clear `editor.operations` until the next
    // microtask — so on the very first focus of a fresh composer, where the
    // selection is always missing, the editor is left unfocused for 10ms.
    //
    // That is the "first letter is dropped after switching rooms" bug: the
    // composer is remounted per room with no selection, the window keydown
    // handler in RoomView calls this to hand the keystroke to it, slate defers,
    // and the character that follows the keydown has nothing focused to land
    // in. Every keystroke afterwards is fine, which is why exactly one
    // character goes missing.
    //
    // Doing the DOM half here rather than waiting: the caret is already back in
    // the model, and moving the DOM selection to match a selection that changed
    // no content is safe — the text nodes it points at are the ones already on
    // screen.
    focusEditorDOM(editor);
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
