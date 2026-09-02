import { BaseRange, Editor } from 'slate';

export enum AutocompletePrefix {
  RoomMention = '#',
  UserMention = '@',
  Emoticon = ':',
  Command = '/',
}
export const AUTOCOMPLETE_PREFIXES: readonly AutocompletePrefix[] = [
  AutocompletePrefix.RoomMention,
  AutocompletePrefix.UserMention,
  AutocompletePrefix.Emoticon,
  AutocompletePrefix.Command,
];

export type AutocompleteQuery<TPrefix extends string> = {
  range: BaseRange;
  prefix: TPrefix;
  text: string;
};

export const getAutocompletePrefix = <TPrefix extends string>(
  editor: Editor,
  queryRange: BaseRange,
  validPrefixes: readonly TPrefix[],
): TPrefix | undefined => {
  const world = Editor.string(editor, queryRange);
  return validPrefixes.find((p) => world.startsWith(p));
};

export const getAutocompleteQueryText = (
  editor: Editor,
  queryRange: BaseRange,
  prefix: string,
): string => Editor.string(editor, queryRange).slice(prefix.length);

// Emoji shortcodes only ever contain word characters plus `+`/`-`
// (e.g. `+1`, `-1`, `e-mail`, `crossed_fingers`). Punctuation like the `)`
// in a typed-out smiley `:)` must NOT trigger the emoji autocomplete — doing
// so silently auto-inserts an unrelated emoji on Enter instead of sending the
// literal text. Anchored to the start so a trailing stray char rejects the
// whole query.
//
// `{2,}` mirrors Discord: the menu only opens once there are at least two
// characters after the `:`. This stops common kaomoji/emoticons that are a
// colon plus a single char — `:3`, `:p`, `:D`, `:o` — from popping the picker
// and auto-replacing on Enter. `:12` (two chars) still triggers, so a
// shortcode like `:1234:` remains completable.
const EMOTICON_QUERY_RE = /^[a-zA-Z0-9_+-]{2,}$/;

export const getAutocompleteQuery = <TPrefix extends string>(
  editor: Editor,
  queryRange: BaseRange,
  validPrefixes: readonly TPrefix[],
): AutocompleteQuery<TPrefix> | undefined => {
  const prefix = getAutocompletePrefix(editor, queryRange, validPrefixes);
  if (!prefix) return undefined;
  const text = getAutocompleteQueryText(editor, queryRange, prefix);
  if (prefix === AutocompletePrefix.Emoticon && !EMOTICON_QUERY_RE.test(text)) {
    return undefined;
  }
  return {
    range: queryRange,
    prefix,
    text,
  };
};
