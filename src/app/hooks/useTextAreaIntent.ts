import { isKeyHotkey } from '../utils/is-hotkey';
import { KeyboardEventHandler, useCallback } from 'react';
import { Cursor, Intent, Operations, TextArea } from '../plugins/text-area';
import { getSettings } from '../state/settings';

/**
 * The indent bindings, from the registry.
 *
 * Both have been listed as rebindable in the keybind settings since the
 * registry existed, while this handler tested literal `tab` / `shift+tab`, so
 * rebinding either did nothing. Read through `getSettings` rather than a hook
 * because this runs inside a keydown callback, and the same escape hatch the
 * editor's own hotkeys use (`components/editor/keyboard.ts`) applies: settings
 * may not be initialised in every context this is imported from.
 */
const getKeybind = (id: string, fallback: string): string => {
  try {
    return getSettings().keybinds[id] ?? fallback;
  } catch {
    return fallback;
  }
};

export const useTextAreaIntentHandler = (
  textArea: TextArea,
  operations: Operations,
  intent: Intent,
) => {
  const handler: KeyboardEventHandler<HTMLTextAreaElement> = useCallback(
    (evt) => {
      const target = evt.currentTarget;

      if (isKeyHotkey(getKeybind('indent', 'tab'), evt)) {
        evt.preventDefault();

        const cursor = Cursor.fromTextAreaElement(target);
        if (textArea.selection(cursor)) {
          operations.select(intent.moveForward(cursor));
        } else {
          operations.deselect(operations.insert(cursor, intent.str));
        }

        target.focus();
      }
      if (isKeyHotkey(getKeybind('unindent', 'shift+tab'), evt)) {
        evt.preventDefault();
        const cursor = Cursor.fromTextAreaElement(target);
        const intentCursor = intent.moveBackward(cursor);
        if (textArea.selection(cursor)) {
          operations.select(intentCursor);
        } else {
          operations.deselect(intentCursor);
        }

        target.focus();
      }
      if (isKeyHotkey('enter', evt) || isKeyHotkey('shift+enter', evt)) {
        evt.preventDefault();
        const cursor = Cursor.fromTextAreaElement(target);
        operations.select(intent.addNewLine(cursor));
      }
      if (isKeyHotkey('mod+enter', evt)) {
        evt.preventDefault();
        const cursor = Cursor.fromTextAreaElement(target);
        operations.select(intent.addNextLine(cursor));
      }
      if (isKeyHotkey('mod+shift+enter', evt)) {
        evt.preventDefault();
        const cursor = Cursor.fromTextAreaElement(target);
        operations.select(intent.addPreviousLine(cursor));
      }
    },
    [textArea, operations, intent],
  );

  return handler;
};
