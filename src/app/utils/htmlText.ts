/**
 * Turning fragments of HTML that arrive from third-party APIs into plain text.
 *
 * Nothing here produces markup: the output is meant for React children, which
 * escape it. These helpers exist so an API's HTML (Hacker News comment bodies,
 * an escaped attribute value) can be *read* without ever being injected.
 */

const NAMED_ENTITIES = new Map<string, string>([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ['nbsp', ' '],
]);

/** The highest code point there is. Anything above it is not a character. */
const MAX_CODE_POINT = 0x10ffff;

/**
 * A numeric reference is whatever the sender typed, and it is allowed to be
 * nonsense: `&#x110000;` and `&#99999999;` both parse to a perfectly finite
 * number that names no character, and `String.fromCodePoint` answers those with
 * a **RangeError** rather than a replacement character.
 *
 * That throw is why this is a function. It escaped through `extractPreviewUrls`
 * into the gallery's history walk, where one such message anywhere in a room
 * ended the scan — and, before the walk learned to catch, the gallery with it.
 * An entity that names nothing is left as the text it came in as, which is also
 * what the surrounding code does with an entity it does not recognise.
 */
const codePointToText = (code: number, raw: string): string =>
  Number.isInteger(code) && code > 0 && code <= MAX_CODE_POINT ? String.fromCodePoint(code) : raw;

/**
 * Decode the entity forms that actually occur in the wild — the five XML named
 * ones, `&nbsp;`, and numeric references in both decimal and hex. An unknown
 * entity is left exactly as it came rather than guessed at, so a literal
 * `&foo;` in someone's text survives unchanged.
 */
export const decodeHtmlEntities = (value: string): string =>
  value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, name: string) => {
    const key = name.toLowerCase();
    // A Map, not an object literal: `key in {…}` is true for everything on
    // `Object.prototype`, so `&constructor;` decoded to the source text of
    // `function Object()` and `&toString;` to a function of its own — arbitrary
    // text injected into whatever was being read, from six characters anyone
    // can type into a message.
    const named = NAMED_ENTITIES.get(key);
    if (named !== undefined) return named;
    if (key.startsWith('#x')) return codePointToText(parseInt(key.slice(2), 16), match);
    if (key.startsWith('#')) return codePointToText(parseInt(key.slice(1), 10), match);
    return match;
  });

/**
 * Flatten an HTML fragment to readable text: paragraph and line-break tags
 * become newlines, every other tag is dropped, entities are decoded, and runs
 * of blank lines collapse.
 *
 * Tag-stripping by regex is safe *because the result is never markup* — it is
 * handed to React as a string. The one thing it must not do is leave a
 * half-stripped tag that a caller might later treat as HTML, so `<` and `>`
 * that survive as text are exactly the ones that were `&lt;`/`&gt;` in the
 * source, decoded after the strip.
 */
export const htmlToPlainText = (html: string): string =>
  html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/?\s*p\s*>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .split('\n')
    .map((line) => decodeHtmlEntities(line).trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
