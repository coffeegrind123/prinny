import { replaceMatch } from '../internal';
import { CodeBlockRule, ListRule } from './rules';
import { runBlockRule } from './runner';
import { BlockMDParser, BlockMDRule } from './type';

/**
 * Discord's block dialect (the `discordMarkdown` setting). Differences from
 * the default parser: headings stop at `###`, a quote line needs a space after
 * `>` (so `>_>` stays literal), `>>> ` quotes the rest of the message, and
 * `-# ` makes a line small subtext. Code blocks and lists are shared.
 *
 * What it changes is the HTML other clients receive, which is why it is a
 * setting: `-#` arrives as <sub>, `>>>` as one blockquote.
 */

const HEADING_REG = /^(#{1,3}) +(.+)\n?/m;
const HeadingRule: BlockMDRule = {
  match: (text) => text.match(HEADING_REG),
  html: (match, parseInline) => {
    const [, g1, g2] = match;
    const level = g1.length;
    return `<h${level} data-md="${g1}">${parseInline ? parseInline(g2) : g2}</h${level}>`;
  },
};

const TRAILING_NEWLINE = /\n$/;

const quoteLinesToHtml = (lines: string[], parseInline?: (txt: string) => string): string =>
  lines.map((line) => `${parseInline ? parseInline(line) : line}<br/>`).join('');

const QUOTE_LINE_PREFIX = /^> ?/;
const BLOCKQUOTE_REG = /(?:^>(?: .*)?(?:\n|$))+/m;
const BlockQuoteRule: BlockMDRule = {
  match: (text) => text.match(BLOCKQUOTE_REG),
  html: (match, parseInline) => {
    const lines = match[0]
      .replace(TRAILING_NEWLINE, '')
      .split('\n')
      .map((line) => line.replace(QUOTE_LINE_PREFIX, ''));
    return `<blockquote data-md=">">${quoteLinesToHtml(lines, parseInline)}</blockquote>`;
  },
};

const MULTILINE_BLOCKQUOTE_REG = /^>>>(?: |\n|$)([\s\S]*)/m;
const MultilineBlockQuoteRule: BlockMDRule = {
  match: (text) => text.match(MULTILINE_BLOCKQUOTE_REG),
  html: (match, parseInline) => {
    const lines = match[1].replace(TRAILING_NEWLINE, '').split('\n');
    return `<blockquote data-md=">>>">${quoteLinesToHtml(lines, parseInline)}</blockquote>`;
  },
};

const SUBTEXT_REG = /^-# +(.+)(\n?)/m;
const SubtextRule: BlockMDRule = {
  match: (text) => text.match(SUBTEXT_REG),
  html: (match, parseInline) => {
    const [, g1, newline] = match;
    return `<sub data-md="-#">${parseInline ? parseInline(g1) : g1}</sub>${newline ? '<br/>' : ''}`;
  },
};

const ESC_BLOCK_SEQ = /^\\(\\*(#{1,3} +|-# +|```|>|(-|\d+\.|[a-zA-Z]\.) +|\* +))/;

export const parseBlockMDDiscord: BlockMDParser = (text, parseInline) => {
  if (text === '') return text;
  let result: string | undefined;

  if (!result) result = runBlockRule(text, CodeBlockRule, parseBlockMDDiscord, parseInline);
  if (!result) {
    result = runBlockRule(text, MultilineBlockQuoteRule, parseBlockMDDiscord, parseInline);
  }
  if (!result) result = runBlockRule(text, BlockQuoteRule, parseBlockMDDiscord, parseInline);
  if (!result) result = runBlockRule(text, ListRule, parseBlockMDDiscord, parseInline);
  if (!result) result = runBlockRule(text, HeadingRule, parseBlockMDDiscord, parseInline);
  if (!result) result = runBlockRule(text, SubtextRule, parseBlockMDDiscord, parseInline);

  if (!result) {
    result = text
      .split('\n')
      .map((lineText) => {
        const match = lineText.match(ESC_BLOCK_SEQ);
        if (!match) return parseInline?.(lineText) ?? lineText;
        const [, g1] = match;
        return replaceMatch(lineText, match, g1, (t) => [parseInline?.(t) ?? t]).join('');
      })
      .join('<br/>');
  }

  return result ?? text;
};
