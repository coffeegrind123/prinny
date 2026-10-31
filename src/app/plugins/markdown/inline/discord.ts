import {
  BoldRule,
  CodeRule,
  EscapeRule,
  LinkRule,
  SpoilerRule,
  StrikeRule,
  UnderlineRule,
} from './rules';
import { runInlineRule, runInlineRules } from './runner';
import { InlineMDParser, InlineMDRule } from './type';

/**
 * Discord's inline dialect (the `discordMarkdown` setting): italics that do
 * not fire on arithmetic or snake_case, and `<https://…>` as a bare link with
 * the brackets hidden. Everything else is the default inline rules.
 */

const MIN_ANY = '(.+?)';
const URL_NEG_LB = '(?<!(https?|ftp|mailto|magnet):\\/\\/\\S*)';
const ESC_NEG_LB = '(?<!\\\\)';

// `*` italic may not have whitespace just inside it, so `2 * 3 * 4` stays literal.
const ITALIC_PREFIX_1 = `${ESC_NEG_LB}\\*`;
const ITALIC_REG_1 = new RegExp(
  `${URL_NEG_LB}${ITALIC_PREFIX_1}(?=[^\\s*])${MIN_ANY}(?<=\\S)${ITALIC_PREFIX_1}(?!\\*)`,
);
const ItalicRule1: InlineMDRule = {
  match: (text) => text.match(ITALIC_REG_1),
  html: (parse, match) => `<i data-md="*">${parse(match[2])}</i>`,
};

// `_` italic sits on word boundaries, so snake_case_names stay literal.
const ITALIC_REG_2 = new RegExp(
  `${URL_NEG_LB}${ESC_NEG_LB}(?<![\\p{L}\\p{N}_])_(?=\\S)${MIN_ANY}${ESC_NEG_LB}_(?![\\p{L}\\p{N}_])`,
  'u',
);
const ItalicRule2: InlineMDRule = {
  match: (text) => text.match(ITALIC_REG_2),
  html: (parse, match) => `<i data-md="_">${parse(match[2])}</i>`,
};

// Text reaching the inline parser is already HTML-escaped, so the brackets
// arrive as &lt; &gt;.
const ANGLE_LINK_REG = /(&lt;)(https?:\/\/\S+?)(&gt;)/;
const AngleLinkRule: InlineMDRule = {
  match: (text) => text.match(ANGLE_LINK_REG),
  html: (_parse, match) => `<a data-md="&lt;" href="${match[2]}">${match[2]}</a>`,
};

const LeveledRules = [
  BoldRule,
  ItalicRule1,
  UnderlineRule,
  ItalicRule2,
  StrikeRule,
  SpoilerRule,
  LinkRule,
  AngleLinkRule,
  EscapeRule,
];

export const parseInlineMDDiscord: InlineMDParser = (text) => {
  if (text === '') return text;
  let result: string | undefined;
  if (!result) result = runInlineRule(text, CodeRule, parseInlineMDDiscord);
  if (!result) result = runInlineRules(text, LeveledRules, parseInlineMDDiscord);
  return result ?? text;
};
