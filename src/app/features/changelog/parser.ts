// Tiny parser for the constrained changelog format. We don't pull a full
// markdown library because every entry follows the same shape:
//   ## DD.MM.YYYY
//   - `<7+char SHA>` Verb Followed By Text — with inline `code`, **bold**,
//     _italic_ and [links](url), and nothing else.
//
// Anything that doesn't match (intro paragraphs, top-level heading,
// trailing notes) is skipped silently — the viewer only renders the
// dated bullet sections, which is what users care about.

export type ChangelogInline =
  | { kind: 'text'; value: string }
  | { kind: 'code'; value: string }
  | { kind: 'bold'; children: ChangelogInline[] }
  | { kind: 'italic'; children: ChangelogInline[] }
  | { kind: 'link'; href: string; children: ChangelogInline[] };

export interface ChangelogBullet {
  sha: string;
  parts: ChangelogInline[];
}

export interface ChangelogEntry {
  /** Raw "DD.MM.YYYY" — used as React key and for `formatDate`. */
  rawDate: string;
  bullets: ChangelogBullet[];
}

const DATE_HEADING_RE = /^##\s+(\d{2}\.\d{2}\.\d{4})\s*$/;
const BULLET_RE = /^-\s+`([a-f0-9]{7,8})`\s+(.+?)\s*$/;
const LINK_RE = /^\[([^\]]+)\]\((\S+?)\)/;
const WORD_CHAR_RE = /[\p{L}\p{N}]/u;

const isWordChar = (ch: string | undefined): boolean => ch !== undefined && WORD_CHAR_RE.test(ch);
const isSpace = (ch: string | undefined): boolean => ch === undefined || /\s/.test(ch);

/**
 * The end of the code span opening at `i`, or -1 if the backtick run there
 * never closes.
 *
 * CommonMark: a run of N backticks opens a span that only a run of exactly N
 * closes, which is how a backtick is put inside a span — ` ``` ` is a span
 * holding three backticks. The old tokenizer split on single backticks, so
 * that exact case (which the changelog uses whenever it talks about code
 * fences) came out as a stray span and loose backticks around it.
 */
function findCodeSpanEnd(text: string, i: number): { close: number; run: number } | null {
  let run = 0;
  while (text[i + run] === '`') run += 1;
  let j = i + run;
  while (j < text.length) {
    if (text[j] !== '`') {
      j += 1;
      continue;
    }
    let m = 0;
    while (text[j + m] === '`') m += 1;
    if (m === run) return { close: j, run };
    j += m;
  }
  return null;
}

/**
 * Index of `marker` at or after `from`, skipping over code spans so a `**`
 * inside backticks does not close the bold around it. -1 if absent.
 */
function findMarker(text: string, marker: string, from: number): number {
  let i = from;
  while (i < text.length) {
    if (text[i] === '`') {
      const span = findCodeSpanEnd(text, i);
      if (span) {
        i = span.close + span.run;
        continue;
      }
    }
    if (text.startsWith(marker, i)) return i;
    i += 1;
  }
  return -1;
}

/**
 * Whether a `_` or `*` at `i` opens emphasis: it must be at the start of a
 * word (so `snake_case_names` and `2*3` are left alone) and be followed by
 * something that is not whitespace.
 */
function opensEmphasis(text: string, i: number): boolean {
  const prev = text[i - 1];
  const next = text[i + 1];
  if (isSpace(next) || next === text[i]) return false;
  return !isWordChar(prev);
}

/** The matching closer for emphasis opened at `open`, or -1. */
function findEmphasisClose(text: string, marker: string, open: number): number {
  let i = open + 1;
  while (i < text.length) {
    const at = findMarker(text, marker, i);
    if (at === -1) return -1;
    const prev = text[at - 1];
    const next = text[at + 1];
    if (!isSpace(prev) && !isWordChar(next) && next !== marker) return at;
    i = at + 1;
  }
  return -1;
}

/**
 * Inline markdown as the changelog actually uses it: code spans, `**bold**`,
 * `_italic_` / `*italic*` and `[links](url)`. Bold and italic nest, and both
 * may contain code. Anything that does not close is kept as literal text —
 * a lone backtick or asterisk is still a character in a sentence.
 */
export function tokenizeInline(text: string): ChangelogInline[] {
  const out: ChangelogInline[] = [];
  let buf = '';
  const flush = () => {
    if (buf.length === 0) return;
    out.push({ kind: 'text', value: buf });
    buf = '';
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    if (ch === '`') {
      const span = findCodeSpanEnd(text, i);
      if (!span) {
        let run = 0;
        while (text[i + run] === '`') run += 1;
        buf += text.slice(i, i + run);
        i += run;
        continue;
      }
      let value = text.slice(i + span.run, span.close);
      // One space each side is stripped when both are present and the content
      // is not all spaces — the CommonMark rule that lets ` ``` ` hold ```.
      if (value.length >= 2 && value.startsWith(' ') && value.endsWith(' ') && value.trim()) {
        value = value.slice(1, -1);
      }
      flush();
      out.push({ kind: 'code', value });
      i = span.close + span.run;
      continue;
    }

    if (text.startsWith('**', i) && !isSpace(text[i + 2])) {
      const close = findMarker(text, '**', i + 2);
      if (close !== -1 && !isSpace(text[close - 1])) {
        flush();
        out.push({ kind: 'bold', children: tokenizeInline(text.slice(i + 2, close)) });
        i = close + 2;
        continue;
      }
    }

    if ((ch === '_' || ch === '*') && opensEmphasis(text, i)) {
      const close = findEmphasisClose(text, ch, i);
      if (close !== -1) {
        flush();
        out.push({ kind: 'italic', children: tokenizeInline(text.slice(i + 1, close)) });
        i = close + 1;
        continue;
      }
    }

    if (ch === '[') {
      const m = LINK_RE.exec(text.slice(i));
      if (m) {
        flush();
        out.push({ kind: 'link', href: m[2], children: tokenizeInline(m[1]) });
        i += m[0].length;
        continue;
      }
    }

    buf += ch;
    i += 1;
  }
  flush();
  return out;
}

export function parseChangelog(md: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let current: ChangelogEntry | null = null;

  for (const rawLine of md.split('\n')) {
    const line = rawLine.trimEnd();

    const dateMatch = line.match(DATE_HEADING_RE);
    if (dateMatch) {
      if (current && current.bullets.length > 0) entries.push(current);
      current = { rawDate: dateMatch[1], bullets: [] };
      continue;
    }

    if (!current) continue;

    const bulletMatch = line.match(BULLET_RE);
    if (bulletMatch) {
      current.bullets.push({
        sha: bulletMatch[1],
        parts: tokenizeInline(bulletMatch[2]),
      });
    }
  }
  if (current && current.bullets.length > 0) entries.push(current);

  return entries;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "18.05.2026" → "18 May 2026". Falls back to the raw string on malformed input. */
export function formatDate(rawDate: string): string {
  const m = rawDate.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return rawDate;
  const day = parseInt(m[1], 10);
  const monthIdx = parseInt(m[2], 10) - 1;
  const year = m[3];
  if (monthIdx < 0 || monthIdx > 11) return rawDate;
  return `${day} ${MONTHS[monthIdx]} ${year}`;
}
