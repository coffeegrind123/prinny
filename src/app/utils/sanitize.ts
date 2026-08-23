import sanitizeHtml, { Transformer } from 'sanitize-html';
import { MESSAGE_LINK_SCHEMES } from './safeUrl';

const MAX_TAG_NESTING = 100;

const permittedHtmlTags = [
  'font',
  'del',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'p',
  'a',
  'ul',
  'ol',
  'sup',
  'sub',
  'li',
  'b',
  'i',
  'u',
  'strong',
  'em',
  'strike',
  's',
  'code',
  'hr',
  'br',
  'div',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'caption',
  'pre',
  'span',
  'img',
  'details',
  'summary',
];

// Shared with the plain-text linkifier so a scheme narrowed in one place cannot
// stay open in the other — the two paths reach the same anchor sink.
const urlSchemes = [...MESSAGE_LINK_SCHEMES];

const permittedTagToAttributes = {
  font: ['style', 'data-mx-bg-color', 'data-mx-color', 'color'],
  span: [
    'style',
    'data-mx-bg-color',
    'data-mx-color',
    'data-mx-spoiler',
    'data-mx-maths',
    'data-mx-pill',
    'data-mx-ping',
    'data-md',
  ],
  div: ['data-mx-maths'],
  blockquote: ['data-md'],
  h1: ['data-md'],
  h2: ['data-md'],
  h3: ['data-md'],
  h4: ['data-md'],
  h5: ['data-md'],
  h6: ['data-md'],
  pre: ['data-md', 'class'],
  ol: ['start', 'type', 'data-md'],
  ul: ['data-md'],
  // `draggable` is here because the allowlist is applied to a tag's attributes
  // *after* its transformer runs, so `transformATag` setting it is not enough
  // on its own — it would be stripped straight back off.
  a: ['name', 'target', 'href', 'rel', 'data-md', 'draggable'],
  img: ['width', 'height', 'alt', 'title', 'src', 'data-mx-emoticon'],
  code: ['class', 'data-md', 'data-label'],
  strong: ['data-md'],
  i: ['data-md'],
  em: ['data-md'],
  u: ['data-md'],
  s: ['data-md'],
  del: ['data-md'],
};

const transformFontTag: Transformer = (tagName, attribs) => ({
  tagName,
  attribs: {
    ...attribs,
    style: `background-color: ${attribs['data-mx-bg-color']}; color: ${attribs['data-mx-color']}`,
  },
});

const transformSpanTag: Transformer = (tagName, attribs) => ({
  tagName,
  attribs: {
    ...attribs,
    style: `background-color: ${attribs['data-mx-bg-color']}; color: ${attribs['data-mx-color']}`,
  },
});

const transformATag: Transformer = (tagName, attribs) => ({
  tagName,
  attribs: {
    ...attribs,
    rel: 'noreferrer noopener',
    target: '_blank',
    // A link inside a message must not be a drag source: a pointer-down on one
    // starts a native link drag instead of a text selection, so dragging out
    // of a link selects nothing and the browser re-anchors the selection at
    // the previous caret — the "copying starts from the left" bug. The CSS in
    // MessageTextBody covers every engine that implements `-webkit-user-drag`;
    // this attribute is what covers Gecko, which implements none.
    draggable: 'false',
  },
});

const transformImgTag: Transformer = (tagName, attribs) => {
  const { src } = attribs;
  if (typeof src === 'string' && src.startsWith('mxc://') === false) {
    return {
      tagName: 'a',
      attribs: {
        href: src,
        rel: 'noreferrer noopener',
        target: '_blank',
      },
      text: attribs.alt || src,
    };
  }
  return {
    tagName,
    attribs: {
      ...attribs,
    },
  };
};

export const sanitizeCustomHtml = (customHtml: string): string =>
  sanitizeHtml(customHtml, {
    allowedTags: permittedHtmlTags,
    allowedAttributes: permittedTagToAttributes,
    disallowedTagsMode: 'discard',
    allowedSchemes: urlSchemes,
    allowedSchemesByTag: {
      a: urlSchemes,
    },
    allowedSchemesAppliedToAttributes: ['href'],
    allowProtocolRelative: false,
    allowedClasses: {
      // `pre` permits a `class` attribute (see permittedTagToAttributes), but
      // this map previously constrained values only for `code` — so message
      // content could wear any of the application's own CSS classes and imitate
      // app chrome. Constrain `pre` to the same language-* vocabulary.
      code: ['language-*'],
      pre: ['language-*'],
    },
    allowedStyles: {
      '*': {
        color: [/^#(?:[0-9a-fA-F]{3}){1,2}$/],
        'background-color': [/^#(?:[0-9a-fA-F]{3}){1,2}$/],
      },
    },
    transformTags: {
      font: transformFontTag,
      span: transformSpanTag,
      a: transformATag,
      img: transformImgTag,
    },
    nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript', 'mx-reply'],
    nestingLimit: MAX_TAG_NESTING,
  });

/**
 * Inline-only sanitiser for a reply chip.
 *
 * A chip is one truncated line, so `sanitizeCustomHtml`'s vocabulary is the
 * wrong shape for it: a blockquote, a list or a code block dropped into that
 * line takes over the row. Everything structural is therefore discarded down to
 * its text, and what survives is the handful of inline tags that read correctly
 * at chip size — emphasis, code, links, and the custom-emoji images that are
 * the whole reason to render markup here rather than the plain body.
 */
export const sanitizeReplyPreviewHtml = (customHtml: string): string =>
  sanitizeHtml(customHtml, {
    allowedTags: ['b', 'i', 'u', 'em', 'strong', 'del', 's', 'strike', 'code', 'span', 'a', 'img'],
    allowedAttributes: {
      span: ['data-mx-spoiler', 'data-mx-pill', 'data-mx-ping'],
      a: ['href', 'rel', 'target'],
      img: ['src', 'alt', 'title', 'width', 'height', 'data-mx-emoticon'],
    },
    disallowedTagsMode: 'discard',
    allowedSchemes: urlSchemes,
    allowedSchemesByTag: { a: urlSchemes },
    allowedSchemesAppliedToAttributes: ['href'],
    allowProtocolRelative: false,
    transformTags: {
      a: transformATag,
      img: transformImgTag,
    },
    // The reply fallback is already stripped from the body elsewhere; strip it
    // here too so a reply to a reply does not quote the whole chain.
    nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript', 'mx-reply'],
    nestingLimit: MAX_TAG_NESTING,
  });

export const sanitizeText = (body: string) => {
  const tagsToReplace: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return body.replace(/[&<>'"]/g, (tag) => tagsToReplace[tag] || tag);
};
