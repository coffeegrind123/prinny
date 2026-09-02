/* eslint-disable jsx-a11y/alt-text */
import {
  ComponentPropsWithoutRef,
  JSX,
  ReactEventHandler,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Element,
  Text as DOMText,
  HTMLReactParserOptions,
  attributesToProps,
  domToReact,
} from 'html-react-parser';
import type { DOMNode } from 'html-react-parser';
import { MatrixClient } from 'matrix-js-sdk';
import classNames from 'classnames';
import { Box, Chip, config, Header, Icon, IconButton, Icons, Scroll, Text } from 'folds';
import { IntermediateRepresentation, Opts as LinkifyOpts, OptFn } from 'linkifyjs';
import Linkify from 'linkify-react';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { CDATA, ChildNode, Document } from 'domhandler';
import * as css from '../styles/CustomHtml.css';
import colorMXID from '../../util/colorMXID';
import {
  getMxIdLocalPart,
  getCanonicalAliasRoomId,
  isRoomAlias,
  mxcUrlToHttp,
} from '../utils/matrix';
import { getMemberDisplayName } from '../utils/room';
import { EMOJI_PATTERN, sanitizeForRegex, URL_NEG_LB } from '../utils/regex';
import { MESSAGE_LINK_SCHEMES } from '../utils/safeUrl';
import { getHexcodeForEmoji, getShortcodeFor } from './emoji';
import { findAndReplace } from '../utils/findAndReplace';
import {
  parseMatrixToRoom,
  parseMatrixToRoomEvent,
  parseMatrixToUser,
  testMatrixTo,
} from './matrix-to';
import { onEnterOrSpace } from '../utils/keyboard';
import { copyToClipboard, tryDecodeURIComponent } from '../utils/dom';
import { useTimeoutToggle } from '../hooks/useTimeoutToggle';
import { MAX_HIGHLIGHT_LENGTH } from './react-prism/constants';
import { renderMaths } from './katex';

const ReactPrism = lazy(() => import('./react-prism/ReactPrism'));

const EMOJI_REG_G = new RegExp(`${URL_NEG_LB}(${EMOJI_PATTERN})`, 'g');

export const LINKIFY_OPTS: LinkifyOpts = {
  attributes: {
    target: '_blank',
    rel: 'noreferrer noopener',
    // Gecko implements neither `-webkit-user-drag` nor any standard
    // equivalent, so the CSS in MessageTextBody that stops a link from
    // hijacking a text selection needs this attribute alongside it. See the
    // comment on that rule for what the hijack looks like.
    draggable: 'false',
  },
  validate: {
    // Plain-text links are an independent path from the HTML sanitizer — this
    // runs on unformatted bodies, where no sanitisation happens — so it has to
    // enforce the same scheme allowlist or narrowing one leaves the other open.
    url: (value) => new RegExp(`^(${MESSAGE_LINK_SCHEMES.join('|')})?:`).test(value),
  },
  ignoreTags: ['span'],
};

export const makeMentionCustomProps = (
  handleMentionClick?: ReactEventHandler<HTMLElement>,
  content?: string,
): ComponentPropsWithoutRef<'a'> => ({
  style: { cursor: 'pointer' },
  target: '_blank',
  rel: 'noreferrer noopener',
  role: 'link',
  tabIndex: handleMentionClick ? 0 : -1,
  onKeyDown: handleMentionClick ? onEnterOrSpace(handleMentionClick) : undefined,
  onClick: handleMentionClick,
  children: content,
});

export const renderMatrixMention = (
  mx: MatrixClient,
  currentRoomId: string | undefined,
  href: string,
  customProps: ComponentPropsWithoutRef<'a'>,
) => {
  const userId = parseMatrixToUser(href);
  if (userId) {
    const currentRoom = mx.getRoom(currentRoomId);
    const mentionsMe = mx.getUserId() === userId;

    return (
      <a
        href={href}
        {...customProps}
        className={css.MentionPlain({ highlight: mentionsMe })}
        // Per-user colour, matching the sender name in the timeline. Skipped
        // when it mentions you, so the highlight variant is not overridden.
        style={mentionsMe ? undefined : { color: colorMXID(userId) }}
        data-mention-id={userId}
      >
        {`@${
          (currentRoom && getMemberDisplayName(currentRoom, userId)) ?? getMxIdLocalPart(userId)
        }`}
      </a>
    );
  }

  const matrixToRoom = parseMatrixToRoom(href);
  if (matrixToRoom) {
    const { roomIdOrAlias, viaServers } = matrixToRoom;
    const mentionRoom = mx.getRoom(
      isRoomAlias(roomIdOrAlias) ? getCanonicalAliasRoomId(mx, roomIdOrAlias) : roomIdOrAlias,
    );

    const fallbackContent = mentionRoom ? `#${mentionRoom.name}` : roomIdOrAlias;
    const mentionId = mentionRoom?.roomId ?? roomIdOrAlias;
    const isCurrentRoom = currentRoomId === mentionId;

    return (
      <a
        href={href}
        {...customProps}
        className={css.MentionPlain({ highlight: isCurrentRoom })}
        style={isCurrentRoom ? undefined : { color: colorMXID(mentionId) }}
        data-mention-id={mentionId}
        data-mention-via={viaServers?.join(',')}
      >
        {customProps.children ? customProps.children : fallbackContent}
      </a>
    );
  }

  const matrixToRoomEvent = parseMatrixToRoomEvent(href);
  if (matrixToRoomEvent) {
    const { roomIdOrAlias, eventId, viaServers } = matrixToRoomEvent;
    const mentionRoom = mx.getRoom(
      isRoomAlias(roomIdOrAlias) ? getCanonicalAliasRoomId(mx, roomIdOrAlias) : roomIdOrAlias,
    );

    const eventMentionId = mentionRoom?.roomId ?? roomIdOrAlias;
    const isCurrentRoomEvent = currentRoomId === eventMentionId;

    return (
      <a
        href={href}
        {...customProps}
        className={css.MentionPlain({ highlight: isCurrentRoomEvent })}
        style={isCurrentRoomEvent ? undefined : { color: colorMXID(eventMentionId) }}
        data-mention-id={eventMentionId}
        data-mention-event-id={eventId}
        data-mention-via={viaServers?.join(',')}
      >
        {customProps.children
          ? customProps.children
          : `Message: ${mentionRoom ? `#${mentionRoom.name}` : roomIdOrAlias}`}
      </a>
    );
  }

  return undefined;
};

export const factoryRenderLinkifyWithMention = (
  mentionRender: (href: string) => JSX.Element | undefined,
): OptFn<(ir: IntermediateRepresentation) => any> => {
  const render: OptFn<(ir: IntermediateRepresentation) => any> = ({
    tagName,
    attributes,
    content,
  }) => {
    if (tagName === 'a' && testMatrixTo(tryDecodeURIComponent(attributes.href))) {
      const mention = mentionRender(tryDecodeURIComponent(attributes.href));
      if (mention) return mention;
    }

    return <a {...attributes}>{content}</a>;
  };
  return render;
};

export const scaleSystemEmoji = (text: string): (string | JSX.Element)[] =>
  findAndReplace(
    text,
    EMOJI_REG_G,
    (match, pushIndex) => (
      <span key={`scaleSystemEmoji-${pushIndex}`} className={css.EmoticonBase}>
        <span className={css.Emoticon()} title={getShortcodeFor(getHexcodeForEmoji(match[0]))}>
          {match[0]}
        </span>
      </span>
    ),
    (txt) => txt,
  );

export const makeHighlightRegex = (highlights: string[]): RegExp | undefined => {
  // An empty term contributes an empty alternative, which matches everywhere at
  // zero length and hangs the consuming scan. Callers reach this with
  // `query.split(' ')` (a double space yields one) and with the `highlights`
  // array from a homeserver's `/search` response, so both a typo and a hostile
  // server can produce it. Drop empties before building the alternation.
  const pattern = highlights
    .filter((highlight) => highlight.length > 0)
    .map(sanitizeForRegex)
    .filter((source) => source.length > 0)
    .join('|');
  if (!pattern) return undefined;
  return new RegExp(pattern, 'gi');
};

export const highlightText = (
  regex: RegExp,
  data: (string | JSX.Element)[],
): (string | JSX.Element)[] =>
  data.flatMap((text) => {
    if (typeof text !== 'string') return text;

    return findAndReplace(
      text,
      regex,
      (match, pushIndex) => (
        <span key={`highlight-${pushIndex}`} className={css.highlightText}>
          {match[0]}
        </span>
      ),
      (txt) => txt,
    );
  });

/**
 * domhandler types `Element.children` as `ChildNode[]`, whose union carries two
 * arms — `CDATA` and `Document` — that html-react-parser's `DOMNode` does not
 * accept. Neither can occur here: CDATA nodes only exist in XML mode, and a
 * Document node is only ever the parse root, never a child. Narrowing keeps the
 * call sites honest instead of casting the mismatch away.
 */
const toDOMNodes = (nodes: ChildNode[]): DOMNode[] =>
  nodes.filter((node): node is DOMNode => !(node instanceof CDATA) && !(node instanceof Document));

/**
 * Recursively extracts and concatenates all text content from an array of ChildNode objects.
 *
 * @param {ChildNode[]} nodes - An array of ChildNode objects to extract text from.
 * @returns {string} The concatenated plain text content of all descendant text nodes.
 */
const extractTextFromChildren = (nodes: ChildNode[]): string => {
  let text = '';

  nodes.forEach((node) => {
    if (node.type === 'text') {
      text += node.data;
    } else if (node instanceof Element && node.children) {
      text += extractTextFromChildren(node.children);
    }
  });

  return text;
};

export function CodeBlock({
  children,
  opts,
}: {
  children: ChildNode[];
  opts: HTMLReactParserOptions;
}) {
  const code = children[0];
  const attribs = code instanceof Element && code.name === 'code' ? code.attribs : undefined;
  const languageClass = attribs?.class;
  const customLabel = attribs?.['data-label'];
  const language =
    languageClass && languageClass.startsWith('language-')
      ? languageClass.replace('language-', '')
      : languageClass;

  const [expanded, setExpand] = useState(false);

  /**
   * Whether the block is taller than the collapsed box, MEASURED rather than
   * guessed from the source.
   *
   * It used to be `text.split('\n').length > 14`, which is wrong in both
   * directions now that long lines wrap: a single 700-character line has no
   * newlines at all and fills the screen, while fifteen short lines may not
   * reach the clamp. Only the rendered height knows.
   *
   * The clamp is applied whenever the block is collapsed, not only once it is
   * known to overflow — otherwise the measurement is circular (no clamp means
   * nothing ever overflows, so the clamp is never applied). Measuring is
   * skipped while expanded, so the control does not disappear the moment it is
   * used: there is no overflow to see when nothing is clamped.
   */
  const scrollRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  const measure = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    // A pixel of slack: sub-pixel line heights make scrollHeight exceed
    // clientHeight by a fraction on blocks that visibly fit.
    setOverflowing(element.scrollHeight > element.clientHeight + 1);
  }, []);

  useEffect(() => {
    if (expanded) return undefined;
    const element = scrollRef.current;
    if (!element) return undefined;

    measure();
    // Fonts load late and the window resizes, and both change how many lines
    // the same text occupies — a one-shot measurement on mount is wrong within
    // a second of being taken.
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, measure, children]);
  const [copied, setCopied] = useTimeoutToggle();

  const [copyFailed, setCopyFailed] = useState(false);

  const handleCopy = () => {
    setCopyFailed(false);
    // Only claim success when the clipboard actually took it. `writeText`
    // rejects when the window is not focused or the permission is refused, and
    // a chip that says "Copied" regardless sends the user to paste something
    // that was never copied.
    copyToClipboard(extractTextFromChildren(children)).then(
      (ok) => (ok ? setCopied() : setCopyFailed(true)),
      () => setCopyFailed(true),
    );
  };

  const toggleExpand = () => {
    setExpand(!expanded);
  };

  return (
    <Text size="T300" as="pre" className={css.CodeBlock}>
      <Header variant="Surface" size="400" className={css.CodeBlockHeader}>
        <Box grow="Yes">
          <Text size="L400" truncate>
            {customLabel ?? language ?? 'Code'}
          </Text>
        </Box>
        <Box shrink="No" gap="200">
          <Chip
            variant={copyFailed ? 'Critical' : copied ? 'Success' : 'Surface'}
            fill="None"
            radii="Pill"
            onClick={handleCopy}
            before={copied && <Icon size="50" src={Icons.Check} />}
          >
            <Text size="B300">{copyFailed ? 'Copy failed' : copied ? 'Copied' : 'Copy'}</Text>
          </Chip>
          {overflowing && (
            <IconButton
              size="300"
              variant="SurfaceVariant"
              outlined
              radii="300"
              onClick={toggleExpand}
              aria-label={expanded ? 'Collapse' : 'Expand'}
            >
              <Icon size="50" src={expanded ? Icons.ChevronTop : Icons.ChevronBottom} />
            </IconButton>
          )}
        </Box>
      </Header>
      <Scroll
        ref={scrollRef}
        style={{
          // In `em`, so the collapsed box is a fixed number of LINES rather
          // than a fixed number of pixels — the app bumps the font size on
          // mobile, where a pixel clamp would show barely half as much.
          maxHeight: expanded ? undefined : '20em',
          paddingBottom: overflowing ? config.space.S400 : undefined,
        }}
        direction="Both"
        variant="SurfaceVariant"
        size="300"
        visibility="Hover"
        hideTrack
      >
        <div id="code-block-content" className={css.CodeBlockInternal}>
          {domToReact(toDOMNodes(children), opts)}
        </div>
      </Scroll>
      {overflowing && !expanded && <Box className={css.CodeBlockBottomShadow} />}
    </Text>
  );
}

export const getReactCustomHtmlParser = (
  mx: MatrixClient,
  roomId: string | undefined,
  params: {
    linkifyOpts: LinkifyOpts;
    highlightRegex?: RegExp;
    handleSpoilerClick?: ReactEventHandler<HTMLElement>;
    handleMentionClick?: ReactEventHandler<HTMLElement>;
    useAuthentication?: boolean;
    renderMaths?: boolean;
  },
): HTMLReactParserOptions => {
  const opts: HTMLReactParserOptions = {
    replace: (domNode) => {
      if (domNode instanceof Element && 'name' in domNode) {
        const { name, attribs, children, parent } = domNode;
        const props = attributesToProps(attribs);

        if (name === 'h1') {
          return (
            <Text {...props} className={css.Heading} size="H2">
              {domToReact(toDOMNodes(children), opts)}
            </Text>
          );
        }

        if (name === 'h2') {
          return (
            <Text {...props} className={css.Heading} size="H3">
              {domToReact(toDOMNodes(children), opts)}
            </Text>
          );
        }

        if (name === 'h3') {
          return (
            <Text {...props} className={css.Heading} size="H4">
              {domToReact(toDOMNodes(children), opts)}
            </Text>
          );
        }

        if (name === 'h4') {
          return (
            <Text {...props} className={css.Heading} size="H4">
              {domToReact(toDOMNodes(children), opts)}
            </Text>
          );
        }

        if (name === 'h5') {
          return (
            <Text {...props} className={css.Heading} size="H5">
              {domToReact(toDOMNodes(children), opts)}
            </Text>
          );
        }

        if (name === 'h6') {
          return (
            <Text {...props} className={css.Heading} size="H6">
              {domToReact(toDOMNodes(children), opts)}
            </Text>
          );
        }

        if (name === 'p') {
          return (
            <Text {...props} className={classNames(css.Paragraph, css.MarginSpaced)} size="Inherit">
              {domToReact(toDOMNodes(children), opts)}
            </Text>
          );
        }

        if (name === 'pre') {
          return <CodeBlock opts={opts}>{children}</CodeBlock>;
        }

        if (name === 'blockquote') {
          return (
            <Text {...props} size="Inherit" as="blockquote" className={css.BlockQuote}>
              {domToReact(toDOMNodes(children), opts)}
            </Text>
          );
        }

        if (name === 'ul') {
          return (
            <ul {...props} className={css.List}>
              {domToReact(toDOMNodes(children), opts)}
            </ul>
          );
        }
        if (name === 'ol') {
          return (
            <ol {...props} className={css.OrderedList}>
              {domToReact(toDOMNodes(children), opts)}
            </ol>
          );
        }

        if (name === 'code') {
          if (parent && 'name' in parent && parent.name === 'pre') {
            const codeReact = domToReact(toDOMNodes(children), opts);
            // Oversized blocks skip highlighting entirely — see
            // MAX_HIGHLIGHT_LENGTH for the measurements behind the bound. Doing
            // the check here (not only inside ReactPrism) also avoids fetching
            // the 287-grammar chunk for a block we would refuse to highlight.
            if (typeof codeReact === 'string' && codeReact.length <= MAX_HIGHLIGHT_LENGTH) {
              // attributesToProps() widens every value to `string | boolean`; read the
              // raw attribute instead, which domhandler types as a plain string.
              let lang: string | undefined = attribs.class;
              if (lang === 'language-rs') lang = 'language-rust';
              else if (lang === 'language-js') lang = 'language-javascript';
              else if (lang === 'language-ts') lang = 'language-typescript';
              return (
                <ErrorBoundary fallback={<code {...props}>{codeReact}</code>}>
                  <Suspense fallback={<code {...props}>{codeReact}</code>}>
                    <ReactPrism>
                      {(ref) => (
                        <code ref={ref} {...props} className={lang}>
                          {codeReact}
                        </code>
                      )}
                    </ReactPrism>
                  </Suspense>
                </ErrorBoundary>
              );
            }
          } else {
            return (
              <Text as="code" size="T300" className={css.Code} {...props}>
                {domToReact(toDOMNodes(children), opts)}
              </Text>
            );
          }
        }

        if (name === 'a' && testMatrixTo(tryDecodeURIComponent(attribs.href))) {
          const content = children.find((child) => !(child instanceof DOMText))
            ? undefined
            : children.map((c) => (c instanceof DOMText ? c.data : '')).join();

          const mention = renderMatrixMention(
            mx,
            roomId,
            tryDecodeURIComponent(attribs.href),
            makeMentionCustomProps(params.handleMentionClick, content),
          );

          if (mention) return mention;
        }

        // MSC2191 maths. The LaTeX source lives in the attribute and the tag's
        // children are the sender's plain-text fallback, so when rendering is
        // off — or the formula does not compile — the fallback is what shows,
        // exactly as a client without maths support would do.
        if ((name === 'span' || name === 'div') && typeof attribs['data-mx-maths'] === 'string') {
          if (params.renderMaths) {
            const rendered = renderMaths(attribs['data-mx-maths'], name === 'div');
            if (rendered) {
              return (
                <span
                  className={css.Maths}
                  // KaTeX output is generated here from the LaTeX source with
                  // trust disabled, so it contains no sender-supplied markup.
                  // eslint-disable-next-line react/no-danger
                  dangerouslySetInnerHTML={{ __html: rendered }}
                />
              );
            }
          }
          return (
            <span {...props} title={attribs['data-mx-maths']}>
              {domToReact(toDOMNodes(children), opts)}
            </span>
          );
        }

        if (name === 'span' && 'data-mx-spoiler' in props) {
          return (
            <span
              {...props}
              role="button"
              tabIndex={params.handleSpoilerClick ? 0 : -1}
              onKeyDown={params.handleSpoilerClick}
              onClick={params.handleSpoilerClick}
              className={css.Spoiler()}
              aria-pressed
              style={{ cursor: 'pointer' }}
            >
              {domToReact(toDOMNodes(children), opts)}
            </span>
          );
        }

        if (name === 'img') {
          const htmlSrc = mxcUrlToHttp(mx, attribs.src, params.useAuthentication);
          if (htmlSrc && attribs.src.startsWith('mxc://') === false) {
            return (
              <a href={htmlSrc} target="_blank" rel="noreferrer noopener">
                {props.alt || props.title || htmlSrc}
              </a>
            );
          }
          if (htmlSrc && 'data-mx-emoticon' in props) {
            return (
              <span className={css.EmoticonBase}>
                <span className={css.Emoticon()}>
                  <img {...props} className={css.EmoticonImg} src={htmlSrc} />
                </span>
              </span>
            );
          }
          if (htmlSrc) return <img {...props} className={css.Img} src={htmlSrc} />;
        }
      }

      if (domNode instanceof DOMText) {
        const linkify =
          !(domNode.parent && 'name' in domNode.parent && domNode.parent.name === 'code') &&
          !(domNode.parent && 'name' in domNode.parent && domNode.parent.name === 'a');

        let jsx = scaleSystemEmoji(domNode.data);

        if (params.highlightRegex) {
          jsx = highlightText(params.highlightRegex, jsx);
        }

        if (linkify) {
          return <Linkify options={params.linkifyOpts}>{jsx}</Linkify>;
        }
        return jsx;
      }
      return undefined;
    },
  };
  return opts;
};
