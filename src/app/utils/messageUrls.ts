import { URL_REG } from './regex';
import { trimReplyFromFormattedBody } from './room';
import { decodeHtmlEntities } from './htmlText';

/**
 * Which links in a message get a preview card.
 *
 * Scanning the plain `body` with a regex is not enough on its own, because the
 * plain body is prose — it is whatever the sending client thought a human
 * should read, and it is allowed to disagree with the actual link target. The
 * failure that motivated this is a link whose path contains spaces:
 *
 *   body:           https://host/misc/12 - Pan Sonic - Tykitys.mp3
 *   formatted_body: <a href="https://host/misc/12%20-%20Pan%20Sonic%20-%20Tykitys.mp3">…</a>
 *
 * A URL regex has to stop at the first space, so the body scan yields
 * `https://host/misc/12` — a URL that 404s, has no file extension, and
 * therefore never reaches the direct-audio player. The card silently degrades
 * to a dead generic preview of a URL nobody sent. The same mismatch happens
 * with `<https://…>` bracket-wrapped links (trailing `>` swallowed into the
 * match) and with markdown-style links whose text is not the target at all.
 *
 * The anchor hrefs in `formatted_body` are the real targets, so they win. The
 * body scan is still consulted, because plenty of clients emit a formatted
 * body that leaves bare URLs un-anchored (`<b>look</b> https://example.com`),
 * and those links would otherwise lose their preview.
 */

// Only `href` on an anchor, and only quoted values. Regex rather than
// DOMParser because this runs on every rendered message in the timeline and
// `parseFromString` on each one is a per-message DOM build; the value is
// re-validated as a web URL below, and nothing here is injected anywhere.
const ANCHOR_HREF_REG = /<a\s[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

const HTTP_SCHEME_REG = /^https?:\/\//i;

/**
 * Code is quoted text, not a link the sender is pointing at.
 *
 * A URL inside a fenced block or an inline span is being *shown* — a config
 * line, a curl command, an example endpoint — and previewing it is both noise
 * and a request the sender never asked us to make.
 *
 * Both halves of the extraction have to know about it, and they see the code
 * differently:
 *
 *  - the formatted body marks it up (`<pre><code>…`, `<code>…`), so those
 *    regions are cut before the anchor scan;
 *  - the plain body may still carry the ```` ``` ```` fences and backticks that
 *    produced it — Element sends the markdown source as `body` — so the same
 *    regions are cut there too.
 *
 * Neither is enough alone, because a body is allowed to disagree with its
 * formatting, and one client in particular does: our own composer serialises a
 * code block to `body` *without* its fences (`elementToPlainText`), so the
 * plain text of a cinny-sent block is a bare URL on a line of its own with
 * nothing to mark it as code. That is exactly the message that reported this.
 * So the text inside the formatted body's code regions is kept as well, and any
 * body-scanned URL found in it is dropped — the formatting is the authority on
 * what was code, whatever the body looks like.
 *
 * A link that is quoted *and* sent for real in the same message survives: it is
 * an anchor outside the code region, and only the body scan is filtered.
 */

// `<pre>` covers the block form (`<pre><code>`), `<code>` the inline one. Both
// are matched lazily so consecutive blocks stay separate regions.
const HTML_CODE_REG = /<pre[\s\S]*?<\/pre\s*>|<code[\s\S]*?<\/code\s*>/gi;

const HTML_TAG_REG = /<[^>]*>/g;

// A fence opens on a line of its own (``` or ~~~, any length) and closes on the
// next line carrying the same marker — or at the end of the message, which is
// how a half-typed block renders. The opening run is captured so ``` inside a
// ~~~ block does not close it.
const FENCED_CODE_REG =
  /(^|\n)[ \t]*(```+|~~~+)[^\n]*(?:\n[\s\S]*?(?:\n[ \t]*\2[ \t]*(?=\n|$)|$)|$)/g;

// Inline spans: a run of backticks closed by an equal-length run. Runs are
// matched longest-first by the greedy `+`, so a ``double`` span is not read as
// two single ones. Applied after the fences, whose backticks are already gone.
const INLINE_CODE_REG = /(`+)[\s\S]*?\1/g;

type FormattedBodyCode = {
  /** The formatted body with every code region replaced by a space. */
  withoutCode: string;
  /** The plain text those regions held, entity-decoded, for matching body URLs. */
  codeText: string;
};

const splitHtmlCode = (formattedBody: string): FormattedBodyCode => {
  if (!formattedBody.includes('<code') && !formattedBody.includes('<pre')) {
    return { withoutCode: formattedBody, codeText: '' };
  }

  const codeParts: string[] = [];
  const withoutCode = formattedBody.replace(HTML_CODE_REG, (region) => {
    codeParts.push(region);
    return ' ';
  });

  return {
    withoutCode,
    codeText: decodeHtmlEntities(codeParts.join(' ').replace(HTML_TAG_REG, ' ')),
  };
};

// Cut regions become a space rather than nothing, so the text either side of a
// span cannot fuse into something that scans as a URL.
const stripMarkdownCode = (body: string): string => {
  if (!body.includes('`') && !body.includes('~~~')) return body;
  return body.replace(FENCED_CODE_REG, ' ').replace(INLINE_CODE_REG, ' ');
};

const anchorHrefs = (formattedBody: string): string[] => {
  // Cheap bail-out for the overwhelmingly common case of a formatted body with
  // no links in it at all, so the scan below only runs where it can pay off.
  if (!formattedBody.includes('href')) return [];

  const hrefs: string[] = [];
  ANCHOR_HREF_REG.lastIndex = 0;
  let match = ANCHOR_HREF_REG.exec(formattedBody);
  while (match !== null) {
    const raw = match[1] ?? match[2] ?? '';
    const href = decodeHtmlEntities(raw).trim();
    // http(s) only: `mailto:`, `matrix:` and relative hrefs are not previewable
    // and must never be handed to a fetch.
    if (HTTP_SCHEME_REG.test(href)) hrefs.push(href);
    match = ANCHOR_HREF_REG.exec(formattedBody);
  }
  return hrefs;
};

/**
 * True when a body-scanned URL is the damaged twin of a link we already have
 * from an anchor, rather than a distinct link of its own:
 *
 *  - the anchor href starts with it — the body scan truncated it (spaces);
 *  - it contains the anchor href — the body scan over-ran it (`<url>`, or a
 *    trailing character the anchor does not have).
 *
 * Either way the anchor is the accurate one and the body's version would only
 * add a second, broken card for the same link.
 */
const supersededByAnchor = (bodyUrl: string, hrefs: string[]): boolean =>
  hrefs.some((href) => href === bodyUrl || href.startsWith(bodyUrl) || bodyUrl.includes(href));

export const extractPreviewUrls = (body: string, formattedBody?: string): string[] => {
  // `body` reaches this function with the reply fallback already trimmed; the
  // formatted body must get the same treatment or a reply would preview every
  // link in the message it quotes, none of which the replier sent.
  const { withoutCode, codeText } =
    typeof formattedBody === 'string'
      ? splitHtmlCode(trimReplyFromFormattedBody(formattedBody))
      : { withoutCode: '', codeText: '' };

  const hrefs = typeof formattedBody === 'string' ? anchorHrefs(withoutCode) : [];
  const bodyUrls = stripMarkdownCode(body).match(URL_REG) ?? [];

  const urls = [...hrefs];
  bodyUrls.forEach((bodyUrl) => {
    // The formatting says this one was code, even where the body does not.
    if (codeText.includes(bodyUrl)) return;
    if (!supersededByAnchor(bodyUrl, hrefs)) urls.push(bodyUrl);
  });

  return [...new Set(urls)];
};
