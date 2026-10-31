import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import parse from 'html-react-parser';
import { Box, Text, as, config } from 'folds';
import * as css from './styles.css';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { parseBlockMD, parseInlineMD } from '../../plugins/markdown';
import { LINKIFY_OPTS, getReactCustomHtmlParser } from '../../plugins/react-custom-html-parser';
import { sanitizeCustomHtml, sanitizeText } from '../../utils/sanitize';

const COLLAPSED_LINES = 6;

type UserBiographyProps = {
  biography: string;
};

// A bio is written by its owner and can run to pages, which pushed the rest
// of the profile card (rich presence, moderation, the message box) off screen.
// Clamp it like Discord does and let the reader expand it in place.
//
// The bio is markdown, rendered through the same pipeline as a sent message:
// the text is HTML-escaped first, so only markdown (never raw HTML from the
// bio's author) produces tags, and the result is sanitised again before React
// sees it.
export const UserBiography = as<'div', UserBiographyProps>(({ biography, ...props }, ref) => {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const textRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  const content = useMemo(() => {
    // Escaping turns a leading `>` into `&gt;`; put it back so quotes still
    // parse, the same way the composer does before its block pass.
    const markdown = sanitizeText(biography).replace(/^((?:\\)*)&gt;/gm, '$1>');
    return parse(
      sanitizeCustomHtml(parseBlockMD(markdown, parseInlineMD)),
      getReactCustomHtmlParser(mx, undefined, { linkifyOpts: LINKIFY_OPTS, useAuthentication }),
    );
  }, [mx, biography, useAuthentication]);

  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el || expanded) {
      return;
    }
    setOverflowing(el.scrollHeight > el.clientHeight + 1);
  }, [biography, expanded]);

  return (
    <Box direction="Column" gap="100" {...props} ref={ref}>
      <Text size="L400">About Me</Text>
      <Text
        as="div"
        ref={textRef}
        className={css.Biography}
        size="T300"
        priority="300"
        style={
          expanded
            ? { maxHeight: '40vh', overflowY: 'auto' }
            : // Line-clamp only counts inline lines; a height cap also clamps
              // markdown's block elements (lists, quotes, headings).
              { maxHeight: `${COLLAPSED_LINES}lh`, overflow: 'hidden' }
        }
      >
        {content}
      </Text>
      {(overflowing || expanded) && (
        <Text
          as="button"
          type="button"
          size="T200"
          priority="400"
          onClick={() => setExpanded((e) => !e)}
          style={{
            alignSelf: 'flex-start',
            cursor: 'pointer',
            background: 'none',
            border: 'none',
            padding: 0,
            marginTop: config.space.S100,
            textDecoration: 'underline',
          }}
        >
          {expanded ? 'Show less' : 'Show more'}
        </Text>
      )}
    </Box>
  );
});
