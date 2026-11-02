import { useCallback, useMemo, useState } from 'react';
import { Icon, IconButton, Icons } from 'folds';
import { Editor, Transforms } from 'slate';
import { Room } from 'matrix-js-sdk';
import { useJoinedRoomBots } from '../../hooks/useBotInfo';
import { safeFocusEditor } from '../../components/editor';
import { UrlConfirmDialog } from '../../components/UrlConfirmDialog';
import type { MenuButton } from '../../../types/matrix/bot';

type BotMenuButtonProps = {
  room: Room;
  editor: Editor;
};

/**
 * Telegram's chat menu button, next to the composer.
 *
 * The `commands` variant does not open a menu of its own — it types `/` into
 * the composer, which opens the command autocomplete that already exists. That
 * list is the same thing Telegram's menu shows (names, descriptions, and here
 * usage hints too), so building a second widget would mean maintaining two
 * pieces of UI that must agree about the same data.
 *
 * The button only appears when a bot in the room actually asked for it, or
 * published commands. A permanent icon for a feature most rooms never use is
 * exactly the clutter the composer's left edge was cleared of.
 */
export function BotMenuButton({ room, editor }: BotMenuButtonProps) {
  const bots = useJoinedRoomBots(room);
  const [confirmingUrl, setConfirmingUrl] = useState<string | null>(null);

  const menu = useMemo<MenuButton | null>(() => {
    let hasCommands = false;
    let urlButton: MenuButton | null = null;

    bots.forEach((info) => {
      if (info.menu_button?.type === 'url') urlButton = info.menu_button;
      if (info.menu_button?.type === 'commands') hasCommands = true;
      if ((info.commands?.length ?? 0) > 0) hasCommands = true;
    });

    // A URL button is an explicit request for something a command list cannot
    // express, so it wins where a bot asked for one.
    if (urlButton) return urlButton;
    return hasCommands ? { type: 'commands' } : null;
  }, [bots]);

  const openCommands = useCallback(() => {
    safeFocusEditor(editor);

    // The autocomplete keys off the word before the cursor, so a `/` glued to
    // the end of a word ("hello/") is not a command query and the menu would
    // silently fail to open. A separating space costs nothing when the
    // composer is empty, which is the usual case.
    let needsSpace = false;
    const { selection } = editor;
    if (selection) {
      const before = Editor.string(editor, {
        anchor: Editor.start(editor, []),
        focus: selection.anchor,
      });
      needsSpace = before.length > 0 && !/\s$/.test(before);
    }

    // Typed rather than inserted as a command element: the autocomplete opens
    // on the query `/`, and a finished element would have nothing to complete.
    Transforms.insertText(editor, needsSpace ? ' /' : '/');
  }, [editor]);

  if (!menu) return null;

  if (menu.type === 'url') {
    return (
      <>
        <IconButton
          onClick={() => setConfirmingUrl(menu.url)}
          variant="SurfaceVariant"
          size="300"
          radii="300"
          aria-label={menu.text}
          title={menu.text}
        >
          <Icon src={Icons.External} />
        </IconButton>
        {confirmingUrl && (
          <UrlConfirmDialog
            url={confirmingUrl}
            onConfirm={() => {
              window.open(confirmingUrl, '_blank', 'noopener,noreferrer');
              setConfirmingUrl(null);
            }}
            onCancel={() => setConfirmingUrl(null)}
          />
        )}
      </>
    );
  }

  return (
    <IconButton
      onClick={openCommands}
      variant="SurfaceVariant"
      size="300"
      radii="300"
      aria-label="Show bot commands"
      title="Show bot commands"
    >
      <Icon src={Icons.Terminal} />
    </IconButton>
  );
}
