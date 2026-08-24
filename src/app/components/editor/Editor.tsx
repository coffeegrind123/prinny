/* eslint-disable no-param-reassign */
import {
  ClipboardEventHandler,
  DragEventHandler,
  KeyboardEventHandler,
  ReactNode,
  forwardRef,
  useCallback,
  useState,
} from 'react';
import { Box, Scroll, Text } from 'folds';
import { Descendant, Editor, createEditor } from 'slate';
import {
  Slate,
  Editable,
  withReact,
  RenderLeafProps,
  RenderElementProps,
  RenderPlaceholderProps,
} from 'slate-react';
import { withHistory } from 'slate-history';
import { BlockType } from './types';
import { RenderElement, RenderLeaf } from './Elements';
import { CustomElement } from './slate';
import * as css from './Editor.css';
import { toggleKeyboardShortcut } from './keyboard';
import { restoreCaretIfMissing } from './utils';

/**
 * A fresh empty document, built per editor — never a shared constant.
 *
 * `<Slate>` assigns `editor.children = initialValue` on first mount, so one
 * module-level constant handed to every editor left them all pointing at the
 * *same* node objects. Slate's DOM bindings key their `NODE_TO_PARENT` /
 * `NODE_TO_INDEX` maps on those objects globally, so with two composers on
 * screen (the room and an open thread panel) whichever rendered last claimed
 * the shared nodes, and `findPath` then failed for the other one — it walks up
 * to the recorded parent and requires it to be the editor it was called with,
 * so it threw "Unable to find the path for Slate node".
 *
 * The visible result: clicking that composer focused it but never gave it a
 * Slate selection, so nothing typed into it registered and Enter, Ctrl+Enter
 * and the send button all did nothing — the message body was still empty.
 * Distinct objects per editor keep the maps unambiguous.
 */
const createInitialValue = (): CustomElement[] => [
  {
    type: BlockType.Paragraph,
    children: [{ text: '' }],
  },
];

const withInline = (editor: Editor): Editor => {
  const { isInline } = editor;

  editor.isInline = (element) =>
    [BlockType.Mention, BlockType.Emoticon, BlockType.Link, BlockType.Command].includes(
      element.type
    ) || isInline(element);

  return editor;
};

const withVoid = (editor: Editor): Editor => {
  const { isVoid } = editor;

  editor.isVoid = (element) =>
    [BlockType.Mention, BlockType.Emoticon, BlockType.Command].includes(element.type) ||
    isVoid(element);

  return editor;
};

export const useEditor = (): Editor => {
  const [editor] = useState(() => withInline(withVoid(withReact(withHistory(createEditor())))));
  return editor;
};

export type EditorChangeHandler = (value: Descendant[]) => void;
type CustomEditorProps = {
  editableName?: string;
  top?: ReactNode;
  bottom?: ReactNode;
  before?: ReactNode;
  after?: ReactNode;
  maxHeight?: string;
  editor: Editor;
  placeholder?: string;
  onKeyDown?: KeyboardEventHandler;
  onKeyUp?: KeyboardEventHandler;
  onChange?: EditorChangeHandler;
  onPaste?: ClipboardEventHandler;
  onDrop?: DragEventHandler;
};
export const CustomEditor = forwardRef<HTMLDivElement, CustomEditorProps>(
  (
    {
      editableName,
      top,
      bottom,
      before,
      after,
      maxHeight = '50vh',
      editor,
      placeholder,
      onKeyDown,
      onKeyUp,
      onChange,
      onPaste,
      onDrop,
    },
    ref
  ) => {
    // Per-instance, and never regenerated: `<Slate>` reads it once on mount.
    const [initialValue] = useState(createInitialValue);

    const renderElement = useCallback(
      (props: RenderElementProps) => <RenderElement {...props} />,
      []
    );

    const renderLeaf = useCallback((props: RenderLeafProps) => <RenderLeaf {...props} />, []);

    const handleKeydown: KeyboardEventHandler = useCallback(
      (evt) => {
        onKeyDown?.(evt);
        const shortcutToggled = toggleKeyboardShortcut(editor, evt);
        if (shortcutToggled) evt.preventDefault();
      },
      [editor, onKeyDown]
    );

    /**
     * Last line of defence for the composer's caret. This is the "text comes out
     * backwards" bug, and the whole mechanism, measured in Chromium:
     *
     * 1. Something leaves `editor.selection` null while the composer keeps DOM
     *    focus. (Which routes do that is still not fully known — hence a guard
     *    here rather than another route-by-route fix; `safeFocusEditor` covers
     *    the ones that were identified.)
     * 2. **Slate then erases the DOM caret on every render.** Its DOM-sync
     *    layout effect runs with no dependency array, and with a null selection
     *    `newDomRange` comes out null, so it takes the
     *    `domSelection.removeAllRanges()` branch. Observed: with the selection
     *    cleared, a real mouse click in the composer left
     *    `getSelection().anchorNode === null` — the caret was wiped by the
     *    render that followed the click.
     * 3. The state sustains itself. The wipe fires `selectionchange` with no
     *    selection, and slate's own `onDOMSelectionChange` answers that with
     *    `Transforms.deselect`, so the model stays null and the next render
     *    wipes again.
     * 4. Typing into a focused contenteditable that has no selection puts the
     *    character at the START of it. Every keystroke that loses the race
     *    against step 3 lands in front of the one before it, and the message
     *    builds up in reverse.
     *
     * It also explains the workaround the reporter found on their own — "all I
     * have to do to fix it is select some text and then it stops going
     * backwards". A real selection is adopted into the model by
     * `onDOMSelectionChange`, which ends step 3's loop.
     *
     * Slate reads `editor.selection` *after* calling this prop —
     * `isDOMEventHandled(event, propsOnDOMBeforeInput)` runs first — so every
     * keystroke starts from a real caret regardless of who cleared it or of who
     * won that race. Verified: from the fully broken state (focused, selection
     * null, no DOM caret at all), typing appends correctly with this in place;
     * with it switched off, the same keystrokes went to the front of the
     * message. Returns nothing, so the event is not marked handled and slate's
     * own handling proceeds untouched.
     */
    const handleDOMBeforeInput = useCallback(() => {
      restoreCaretIfMissing(editor);
    }, [editor]);

    const renderPlaceholder = useCallback(
      ({ attributes, children }: RenderPlaceholderProps) => (
        <span {...attributes} className={css.EditorPlaceholderContainer}>
          {/* Inner component to style the actual text position and appearance */}
          <Text as="span" className={css.EditorPlaceholderTextVisual} truncate>
            {children}
          </Text>
        </span>
      ),
      []
    );

    return (
      <div className={css.Editor} ref={ref}>
        <Slate editor={editor} initialValue={initialValue} onChange={onChange}>
          {top}
          <Box alignItems="Start">
            {before && (
              <Box className={css.EditorOptions} alignItems="Center" gap="100" shrink="No">
                {before}
              </Box>
            )}
            <Scroll
              className={css.EditorTextareaScroll}
              variant="SurfaceVariant"
              style={{ maxHeight }}
              size="300"
              visibility="Hover"
              hideTrack
            >
              <Editable
                data-editable-name={editableName}
                className={css.EditorTextarea}
                placeholder={placeholder}
                renderPlaceholder={renderPlaceholder}
                renderElement={renderElement}
                renderLeaf={renderLeaf}
                onDOMBeforeInput={handleDOMBeforeInput}
                onKeyDown={handleKeydown}
                onKeyUp={onKeyUp}
                onPaste={onPaste}
                onDrop={onDrop}
              />
            </Scroll>
            {after && (
              <Box className={css.EditorOptions} alignItems="Center" gap="100" shrink="No">
                {after}
              </Box>
            )}
          </Box>
          {bottom}
        </Slate>
      </div>
    );
  }
);
