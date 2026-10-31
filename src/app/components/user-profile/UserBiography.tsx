import { useLayoutEffect, useRef, useState } from 'react';
import { Box, Text, as, config } from 'folds';
import * as css from './styles.css';

const COLLAPSED_LINES = 6;

type UserBiographyProps = {
  biography: string;
};

// A bio is written by its owner and can run to pages, which pushed the rest
// of the profile card (rich presence, moderation, the message box) off screen.
// Clamp it like Discord does and let the reader expand it in place.
export const UserBiography = as<'div', UserBiographyProps>(({ biography, ...props }, ref) => {
  const textRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

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
            : {
                display: '-webkit-box',
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp: COLLAPSED_LINES,
                overflow: 'hidden',
              }
        }
      >
        {biography}
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
