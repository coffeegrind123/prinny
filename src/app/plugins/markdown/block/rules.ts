import { MatchResult } from '../internal';
import { BlockMDRule } from './type';

const HEADING_REG_1 = /^(#{1,6}) +(.+)\n?/m;
export const HeadingRule: BlockMDRule = {
  match: (text) => text.match(HEADING_REG_1),
  html: (match, parseInline) => {
    const [, g1, g2] = match;
    const level = g1.length;
    return `<h${level} data-md="${g1}">${parseInline ? parseInline(g2) : g2}</h${level}>`;
  },
};

// Fenced code blocks.
//
// Two things have to be right, and they pull in opposite directions.
//
// FORGIVENESS. Discord accepts far more than CommonMark does, and so does
// this, because these are the shapes you actually get by typing ``` and
// pasting:
//
//   ```code```            one line -> a block containing "code"
//   ```lang\ncode\n```    a language token, but ONLY when a bare word is
//                         followed immediately by a newline
//   ```code\nmore\n```    content starting on the fence line itself
//   ```\ncode\nmore```    closing fence at the end of the last content line
//
// WHICH FENCE CLOSES IT. This is the part that was wrong. The closing fence
// used to be found lazily — the first line after the opening fence that looks
// like one — which is CommonMark's rule and is exactly wrong for the single
// most common way this feature gets used: wrapping something in ``` that
// itself contains a fenced block. Copy a chunk of documentation or of an
// assistant's answer, wrap it in ```, and the block ended at the *inner*
// block's closing fence, leaving the back half of the message as loose prose
// with a stray ``` dangling at the end of it. Reported as "code blocks are
// broken", and from the outside that is precisely what it looks like.
//
// The fix is to count depth instead of stopping at the first candidate, and
// the thing that makes it possible is a CommonMark rule that holds here too:
// **a closing fence may not carry an info string.** So a line that is a fence
// run followed by a bare word (```bash, ```json) can only ever be an *opener*,
// which is what tells an inner block's closing fence apart from this block's
// own. Walk the openers and closers in order, and the fence that brings the
// depth back to zero is ours.
//
// What this deliberately does NOT do is get greedy. Two separate code blocks
// in one message stay two blocks, because the first bare fence after the
// opening one balances it and the walk stops there.
const CODEBLOCK_OPEN_REG = /^(`{3,})(?!`)/m;

// A line that is a fence run plus a NON-EMPTY info string, and nothing else.
// Only ever an opener — see above. Requires a preceding newline: the opening
// fence is already known not to be followed by a backtick, so nothing at the
// very start of the body can be one of these.
const CODEBLOCK_INNER_OPEN_REG = /\n(`{3,})(?!`)[^\s`]+[ \t]*(?=\n|$)/g;

/** Positions where a fence of `length` backticks could close a block. */
const closerRegFor = (length: number): RegExp => new RegExp(`\`{${length},} *(?!.)`, 'g');

type FenceEvent = { index: number; end: number; opens: boolean };

/**
 * The extent of the first fenced block in `text`, as a synthetic match.
 *
 * Shaped like a `RegExpMatchArray` — `[whole, fence, body]` plus `index` — so
 * it drops into `runBlockRule`/`replaceMatch` exactly as the regex it replaced
 * did.
 */
const matchCodeBlock = (text: string): MatchResult | null => {
  const open = text.match(CODEBLOCK_OPEN_REG);
  if (!open || open.index === undefined) return null;

  const fence = open[1];
  const bodyStart = open.index + fence.length;
  const region = text.slice(bodyStart);

  const events: FenceEvent[] = [];

  CODEBLOCK_INNER_OPEN_REG.lastIndex = 0;
  let innerOpen = CODEBLOCK_INNER_OPEN_REG.exec(region);
  while (innerOpen !== null) {
    events.push({
      index: innerOpen.index,
      end: innerOpen.index + innerOpen[0].length,
      opens: true,
    });
    innerOpen = CODEBLOCK_INNER_OPEN_REG.exec(region);
  }

  const closerReg = closerRegFor(fence.length);
  let closer = closerReg.exec(region);
  while (closer !== null) {
    events.push({ index: closer.index, end: closer.index + closer[0].length, opens: false });
    closer = closerReg.exec(region);
  }

  events.sort((a, b) => a.index - b.index);

  const closers = events.filter((event) => !event.opens);
  if (closers.length === 0) return null;

  let depth = 1;
  let chosen: FenceEvent | undefined;
  for (let i = 0; i < events.length; i += 1) {
    const event = events[i];
    if (event.opens) {
      depth += 1;
    } else {
      depth -= 1;
      if (depth === 0) {
        chosen = event;
        break;
      }
    }
  }

  // Unbalanced — more openers than closers, so no fence brings the depth back
  // to zero. There is no correct answer here, and the *last* closer is the
  // forgiving one: it keeps the whole paste inside the block rather than
  // rendering the message as loose prose. Returning nothing would print every
  // backtick literally, which is the outcome this rule exists to avoid.
  const end = chosen ?? closers[closers.length - 1];

  const whole = text.slice(
    open.index,
    // The regex this replaced absorbed one trailing newline after the closing
    // fence, so the block does not leave an empty line behind it.
    bodyStart + end.end + (region[end.end] === '\n' ? 1 : 0),
  );

  const result = [whole, fence, region.slice(0, end.index)] as unknown as RegExpMatchArray;
  result.index = open.index;
  result.input = text;
  return result;
};

// A language token is a run with no whitespace and no backtick, terminated by a
// newline. Anything else on the fence line — "const a = 1;", a sentence, an
// empty rest-of-line — is content, not a language.
const CODEBLOCK_INFO_REG = /^([^\s`]*)\n/;
export const CodeBlockRule: BlockMDRule = {
  match: matchCodeBlock,
  html: (match) => {
    const [, fence, body] = match;
    const infoMatch = body.match(CODEBLOCK_INFO_REG);
    // `infoMatch[1]` is empty for a plain "```\n" opening: no language, and the
    // newline still belongs to the fence rather than to the code.
    const info = infoMatch?.[1] || null;
    const content = infoMatch ? body.slice(infoMatch[0].length) : body;
    // use last identifier after dot, e.g. for "example.json" gets us "json" as language code.
    const langCode = info ? info.substring(info.lastIndexOf('.') + 1) : null;
    const filename = info !== langCode ? info : null;
    const classNameAtt = langCode ? ` class="language-${langCode}"` : '';
    const filenameAtt = filename ? ` data-label="${filename}"` : '';
    return `<pre data-md="${fence}"><code${classNameAtt}${filenameAtt}>${content}</code></pre>`;
  },
};

/**
 * Rewrite every fenced code block in `text` into the canonical CommonMark
 * shape: opening fence and info string alone on their own line, content, then
 * the closing fence alone on its own line.
 *
 * This exists because of what a Matrix message actually puts on the wire. A
 * message carries both an HTML `formatted_body` and a plain-text `body`, and
 * the `body` is the fallback every client that does not render our HTML falls
 * back to — including clients that re-parse it as markdown. The forgiving
 * fence shapes above are read correctly *here* and are simply wrong there:
 * `` ```code``` `` on one line is not a CommonMark code fence at all (the info
 * string may not contain a backtick), so a strict reader sees an inline code
 * span, and that is exactly how it comes out the far end. The report was "type
 * it on one line and it shows up as inline code" — from another client, which
 * was reading the fallback we sent it.
 *
 * The fence must be alone on its line precisely because the opening fence is
 * allowed an info string; that is the whole reason the rule exists. So rather
 * than emit a shape that only this client understands, accept the loose input
 * and put the standard form on the wire. The editor stays forgiving and other
 * clients stay correct — instead of the leniency becoming everyone else's
 * problem.
 *
 * Deliberately shares `matchCodeBlock` with the HTML rule above: `body` and
 * `formatted_body` describing different blocks would be worse than either
 * being loose, and this is the only thing that keeps the two agreeing on where
 * a block starts and ends.
 */
export const canonicalFencedCodeBlocks = (text: string): string => {
  const match = matchCodeBlock(text);
  if (!match || match.index === undefined) return text;

  const [whole, fence, body] = match;
  const infoMatch = body.match(CODEBLOCK_INFO_REG);
  const info = infoMatch?.[1] ?? '';
  const content = infoMatch ? body.slice(infoMatch[0].length) : body;
  // One newline before the closing fence, never two: the closer supplies the
  // line break, so keeping the content's own trailing newlines would add a
  // blank line to the block on every round trip through this.
  const inner = content.replace(/\n+$/, '');

  // The fence has to be LONGER than any backtick run inside the block, or a
  // strict reader closes it on the first one. That is not a nicety: the case
  // that started all of this is a paste that contains a fenced block of its
  // own, and emitting `` ``` `` around content that itself contains `` ``` ``
  // sends something that reads correctly here and falls apart anywhere else —
  // the outer block ending early, the back half arriving as loose prose. A
  // longer fence is CommonMark's own answer for nesting, and it costs a
  // backtick.
  const longestRun = Math.max(0, ...(inner.match(/`+/g) ?? []).map((run) => run.length));
  const fenceLength = Math.max(fence.length, longestRun + 1, 3);
  const outerFence = '`'.repeat(fenceLength);

  const canonical = `${outerFence}${info}\n${inner === '' ? '' : `${inner}\n`}${outerFence}`;
  const before = text.slice(0, match.index);
  const after = text.slice(match.index + whole.length);
  // `matchCodeBlock` absorbs one newline after the closing fence; put it back,
  // or the block would run into whatever the sender wrote on the next line.
  const trailing = whole.endsWith('\n') ? '\n' : '';

  return `${before}${canonical}${trailing}${canonicalFencedCodeBlocks(after)}`;
};

const BLOCKQUOTE_MD_1 = '>';
const QUOTE_LINE_PREFIX = /^> */;
const BLOCKQUOTE_TRAILING_NEWLINE = /\n$/;
const BLOCKQUOTE_REG_1 = /(^>.*\n?)+/m;
export const BlockQuoteRule: BlockMDRule = {
  match: (text) => text.match(BLOCKQUOTE_REG_1),
  html: (match, parseInline) => {
    const [blockquoteText] = match;

    const lines = blockquoteText
      .replace(BLOCKQUOTE_TRAILING_NEWLINE, '')
      .split('\n')
      .map((lineText) => {
        const line = lineText.replace(QUOTE_LINE_PREFIX, '');
        if (parseInline) return `${parseInline(line)}<br/>`;
        return `${line}<br/>`;
      })
      .join('');
    return `<blockquote data-md="${BLOCKQUOTE_MD_1}">${lines}</blockquote>`;
  },
};

const ORDERED_LIST_MD_1 = '-';
const UNORDERED_LIST_MD_1 = '*';
/**
 * A list item marker.
 *
 * The digit run is `\d+`, not a single `\d`: with one digit, `10. item` did not
 * match at all, so a list that reached ten stopped being a list from the tenth
 * item onwards and the rest rendered as plain paragraphs. Letter markers stay
 * single-character (`a.`, `i.`) because that is the whole vocabulary there.
 */
const LIST_ITEM_REG = /^( *)([-*+]|\d+\.|[a-zA-Z]\.) +(.+)$/;
type ListType = 'ol' | 'ul';

function getListType(marker: string): ListType {
  // `-`, `*` and `+` are all unordered bullets (CommonMark / Discord); only the
  // `N.` / `a.` markers are ordered. The old check treated `*` as the sole
  // bullet, so a `- item` list was emitted as <ol> — a numbered list on the
  // wire, visible even in "view source".
  return marker === '-' || marker === '*' || marker === '+' ? 'ul' : 'ol';
}

function getOrderedMeta(marker: string) {
  // Also `\d+`, so `10.` starts the list at ten rather than being ignored.
  const startMatch = marker.match(/^(\d+)\./);
  const typeMatch = marker.match(/^([aAiI])\./);

  return {
    start: startMatch?.[1],
    type: typeMatch?.[1],
  };
}

interface ParsedLine {
  indent: number;
  marker: string;
  content: string;
  listType: ListType;
}

function parseLines(text: string): ParsedLine[] {
  return text
    .replace(/\n$/, '')
    .split('\n')
    .map((line) => {
      const match = line.match(LIST_ITEM_REG);

      if (!match) return null;

      const [, spaces, marker, content] = match;

      return {
        indent: spaces.length,
        marker,
        content,
        listType: getListType(marker),
      };
    })
    .filter(Boolean) as ParsedLine[];
}

function openList(line: ParsedLine) {
  if (line.listType === 'ul') {
    return `<ul data-md="${UNORDERED_LIST_MD_1}">`;
  }
  const { type, start } = getOrderedMeta(line.marker);
  const dataMdAtt = `data-md="${type || start || ORDERED_LIST_MD_1}"`;
  const startAtt = start ? ` start="${start}"` : '';
  const typeAtt = type ? ` type="${type}"` : '';
  return `<ol ${dataMdAtt}${startAtt}${typeAtt}>`;
}

function closeList(listType: ListType) {
  return listType === 'ul' ? '</ul>' : '</ol>';
}

function buildList(lines: ParsedLine[], parseInline?: (s: string) => string): string {
  let html = '';

  const stack: ('ul' | 'ol')[] = [];

  lines.forEach((line, index) => {
    const prev = lines[index - 1];
    const next = lines[index + 1];

    const content = parseInline ? parseInline(line.content) : line.content;

    // FIRST ITEM
    if (!prev) {
      html += openList(line);
      stack.push(line.listType);
    }

    // DEEPER INDENT > open nested list
    else if (line.indent > prev.indent) {
      html += openList(line);
      stack.push(line.listType);
    }

    // SAME LEVEL
    else if (line.indent === prev.indent) {
      html += '</li>';

      // different list type
      if (line.listType !== prev.listType) {
        html += closeList(stack.pop()!);

        html += openList(line);
        stack.push(line.listType);
      }
    }

    // GOING BACK UP
    else if (line.indent < prev.indent) {
      html += '</li>';

      while (stack.length > line.indent + 1) {
        html += closeList(stack.pop()!);
        html += '</li>';
      }

      if (line.listType !== stack[stack.length - 1]) {
        html += closeList(stack.pop()!);

        html += openList(line);
        stack.push(line.listType);
      }
    }

    html += `<li><p>${content}</p>`;

    // LAST ITEM cleanup
    if (!next) {
      html += '</li>';

      while (stack.length) {
        html += closeList(stack.pop()!);
      }
    }
  });

  return html;
}

const LIST_REG_1 = /^(?: *(?:[-*+]|[\da-zA-Z]\.) +.+\n?)+/m;
export const ListRule: BlockMDRule = {
  match: (text) => text.match(LIST_REG_1),
  html: (match, parseInline) => {
    const [listText] = match;

    const lines = parseLines(listText);

    const html = buildList(lines, parseInline);

    return html;
  },
};

// The marker alternatives match LIST_ITEM_REG, multi-digit runs included — an
// escape that does not recognise `10.` cannot escape a list that starts at ten.
export const UN_ESC_BLOCK_SEQ = /^\\*(#{1,6} +|```|>|(-|\d+\.|[a-zA-Z]\.) +|\* +)/;
export const ESC_BLOCK_SEQ = /^\\(\\*(#{1,6} +|```|>|(-|\d+\.|[a-zA-Z]\.) +|\* +))/;
