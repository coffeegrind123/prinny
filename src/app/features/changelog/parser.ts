// Tiny parser for the constrained changelog format. We don't pull a full
// markdown library because every entry follows the same shape:
//   ## DD.MM.YYYY
//   - `<7+char SHA>` Verb Followed By Text — with optional `code` spans.
//
// Anything that doesn't match (intro paragraphs, top-level heading,
// trailing notes) is skipped silently — the viewer only renders the
// dated bullet sections, which is what users care about.

export interface ChangelogBulletPart {
  kind: 'text' | 'code';
  value: string;
}

export interface ChangelogBullet {
  sha: string;
  parts: ChangelogBulletPart[];
}

export interface ChangelogEntry {
  /** Raw "DD.MM.YYYY" — used as React key and for `formatDate`. */
  rawDate: string;
  bullets: ChangelogBullet[];
}

const DATE_HEADING_RE = /^##\s+(\d{2}\.\d{2}\.\d{4})\s*$/;
const BULLET_RE = /^-\s+`([a-f0-9]{7,8})`\s+(.+?)\s*$/;

function tokenizeInline(text: string): ChangelogBulletPart[] {
  // Split on backtick-delimited code spans only. Bold/italic/links land
  // verbatim — easy to extend later if we start using them.
  const parts: ChangelogBulletPart[] = [];
  const segments = text.split(/(`[^`]+`)/);
  for (const seg of segments) {
    if (!seg) continue;
    if (seg.startsWith('`') && seg.endsWith('`') && seg.length >= 2) {
      parts.push({ kind: 'code', value: seg.slice(1, -1) });
    } else {
      parts.push({ kind: 'text', value: seg });
    }
  }
  return parts;
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
