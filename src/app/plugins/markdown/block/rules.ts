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

// opening fence: 3 or more backticks at the start of a line, captured in group
// 1 so the closing fence can be matched against the same length via \1
// group 2 is everything between the fences, info string included
// the closing fence ends a line (trailing spaces allowed) and may be longer
// than the opening one, which is what `*` after \1 absorbs
//
// Everything about this shape is deliberate, because Discord is far more
// forgiving than the previous pattern was:
//
//   ```code```            one line -> a block containing "code"
//   ```lang\ncode\n```    a language token, but ONLY when a bare word is
//                         followed immediately by a newline
//   ```code\nmore\n```    content starting on the fence line itself
//   ```\ncode\nmore```    closing fence at the end of the last content line
//
// The old regex demanded `\n` right after the info string and a closing fence
// alone on its own line, so the last two forms did not match at all and came
// out as literal backticks around the text. Those are exactly the forms you get
// by typing ``` and pasting several lines after it — the common case, and the
// one that was reported broken.
const CODEBLOCK_REG_1 = /^(`{3,})(?!`)([\s\S]*?)\1`* *(?!.)\n?/m;
// A language token is a run with no whitespace and no backtick, terminated by a
// newline. Anything else on the fence line — "const a = 1;", a sentence, an
// empty rest-of-line — is content, not a language.
const CODEBLOCK_INFO_REG = /^([^\s`]*)\n/;
export const CodeBlockRule: BlockMDRule = {
  match: (text) => text.match(CODEBLOCK_REG_1),
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
