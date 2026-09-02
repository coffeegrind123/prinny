import { KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo } from 'react';
import { Editor } from 'slate';
import { Box, MenuItem, Text, toRem } from 'folds';
import { Room } from 'matrix-js-sdk';

import { AutocompleteQuery } from './autocompleteQuery';
import { AutocompleteMenu } from './AutocompleteMenu';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { UseAsyncSearchOptions, useAsyncSearch } from '../../../hooks/useAsyncSearch';
import { clickFocusedAutocompleteItem, onTabPress } from '../../../utils/keyboard';
import { createEmoticonElement, moveCursor, replaceWithElement, safeFocusEditor } from '../utils';
import { useRecentEmoji } from '../../../hooks/useRecentEmoji';
import { useRelevantImagePacks } from '../../../hooks/useImagePacks';
import { IEmoji, emojis } from '../../../plugins/emoji';
import { mxcUrlToHttp } from '../../../utils/matrix';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { ImageUsage, PackImageReader } from '../../../plugins/custom-emoji';
import { getEmoticonSearchStr } from '../../../plugins/utils';

type EmoticonCompleteHandler = (key: string, shortcode: string) => void;

type EmoticonSearchItem = PackImageReader | IEmoji;

type EmoticonAutocompleteProps = {
  imagePackRooms: Room[];
  editor: Editor;
  query: AutocompleteQuery<string>;
  requestClose: () => void;
};

const SEARCH_OPTIONS: UseAsyncSearchOptions = {
  matchOptions: {
    contain: true,
  },
};

export function EmoticonAutocomplete({
  imagePackRooms,
  editor,
  query,
  requestClose,
}: EmoticonAutocompleteProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();

  const imagePacks = useRelevantImagePacks(ImageUsage.Emoticon, imagePackRooms);
  const recentEmoji = useRecentEmoji(mx, 20);

  const searchList = useMemo(() => {
    const list: Array<EmoticonSearchItem> = [];
    return list.concat(
      imagePacks.flatMap((pack) => pack.getImages(ImageUsage.Emoticon)),
      emojis,
    );
  }, [imagePacks]);

  const [result, search, resetSearch] = useAsyncSearch(
    searchList,
    getEmoticonSearchStr,
    SEARCH_OPTIONS,
  );
  const autoCompleteEmoticon = result ? result.items.slice(0, 20) : recentEmoji;

  useEffect(() => {
    if (query.text) search(query.text);
    else resetSearch();
  }, [query.text, search, resetSearch]);

  const handleAutocomplete: EmoticonCompleteHandler = (key, shortcode) => {
    const emoticonEl = createEmoticonElement(key, shortcode);
    replaceWithElement(editor, query.range, emoticonEl);
    moveCursor(editor, true);
    safeFocusEditor(editor);
    requestClose();
  };

  const commitSelected = () => {
    // Prefer the arrowed-to item; otherwise commit the first result.
    if (clickFocusedAutocompleteItem()) return;
    if (autoCompleteEmoticon.length === 0) return;
    const emoticon = autoCompleteEmoticon[0];
    const key = 'url' in emoticon ? emoticon.url : emoticon.unicode;
    handleAutocomplete(key, emoticon.shortcode);
  };

  // Capture phase — fires before the editor's keydown so we can stopPropagation
  // and prevent the editor from ever seeing Enter/Tab when autocomplete is open.
  useEffect(() => {
    const handleTab = (evt: KeyboardEvent) => {
      onTabPress(evt, () => {
        if (autoCompleteEmoticon.length === 0) return;
        commitSelected();
      });
    };
    window.addEventListener('keydown', handleTab, true);
    return () => window.removeEventListener('keydown', handleTab, true);
  });

  useEffect(() => {
    const handleEnter = (evt: KeyboardEvent) => {
      if (evt.key === 'Enter' && !evt.metaKey && !evt.ctrlKey && autoCompleteEmoticon.length > 0) {
        evt.preventDefault();
        evt.stopPropagation();
        commitSelected();
      }
    };
    window.addEventListener('keydown', handleEnter, true);
    return () => window.removeEventListener('keydown', handleEnter, true);
  });

  return autoCompleteEmoticon.length === 0 ? null : (
    <AutocompleteMenu headerContent={<Text size="L400">Emojis</Text>} requestClose={requestClose}>
      {autoCompleteEmoticon.map((emoticon, index) => {
        const isCustomEmoji = 'url' in emoticon;
        const key = isCustomEmoji ? emoticon.url : emoticon.unicode;
        const customEmojiUrl = mxcUrlToHttp(mx, key, useAuthentication);

        return (
          <MenuItem
            key={emoticon.shortcode + key}
            as="button"
            radii="300"
            data-autocomplete-index={index}
            aria-pressed={index === 0}
            onKeyDown={(evt: ReactKeyboardEvent<HTMLButtonElement>) =>
              onTabPress(evt, () => handleAutocomplete(key, emoticon.shortcode))
            }
            onClick={() => handleAutocomplete(key, emoticon.shortcode)}
            before={
              isCustomEmoji && customEmojiUrl ? (
                <Box
                  shrink="No"
                  as="img"
                  src={customEmojiUrl}
                  alt={emoticon.shortcode}
                  style={{ width: toRem(24), height: toRem(24), objectFit: 'contain' }}
                />
              ) : (
                <Box
                  shrink="No"
                  as="span"
                  display="InlineFlex"
                  style={{ fontSize: toRem(24), lineHeight: toRem(24) }}
                >
                  {key}
                </Box>
              )
            }
          >
            <Text style={{ flexGrow: 1 }} size="B400" truncate>
              :{emoticon.shortcode}:
            </Text>
          </MenuItem>
        );
      })}
    </AutocompleteMenu>
  );
}
