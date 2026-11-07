import { CSSProperties, useState } from 'react';
import { Box, color, config, Icon, Icons, Text, toRem } from 'folds';

// The 16:9 box a site player (YouTube, Twitch) sits in. The card shrinks to
// its content, so without an explicit width a player with no text around it
// (no preview from the homeserver, which is common for Twitch and YouTube)
// came out a few hundred pixels wide; this fills the card's 432px cap and
// still fits a narrow screen.
const FRAME_STYLE: CSSProperties = {
  position: 'relative',
  width: toRem(432),
  maxWidth: '100%',
  paddingBottom: '56.25%',
  height: 0,
  overflow: 'hidden',
  backgroundColor: color.SurfaceVariant.Container,
};

const FILL_STYLE: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  border: 'none',
};

type SitePlayerProps = {
  /** The player URL, built by the caller from parsed ids only. Loaded on click. */
  src: string;
  /** Accessible name of the player, and the line shown on the facade. */
  title: string;
  /** Who serves the player, said on the button before anything is loaded. */
  site: string;
  /** Poster from a host the card already talks to; otherwise a plain panel. */
  poster?: string;
};

/**
 * A site's video player, loaded only when the reader asks for it.
 *
 * Embedding the player straight away made every client that scrolled past a
 * link load the site's player, ad and tracking scripts (Twitch's pulls in
 * Amazon's ad system), and filled the console with their warnings. Until the
 * click this renders a button and at most a poster image; the click swaps in
 * the frame and starts playback, so watching still takes one click.
 */
export function SitePlayer({ src, title, site, poster }: SitePlayerProps) {
  const [active, setActive] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);

  if (active) {
    return (
      <Box style={FRAME_STYLE}>
        <iframe
          style={FILL_STYLE}
          src={src}
          title={title}
          // The narrowest sandbox that still plays video. Deliberately absent:
          // allow-top-navigation (would let the frame navigate this window
          // away) and allow-popups (would let it open new ones).
          sandbox="allow-scripts allow-same-origin allow-presentation"
          // Trimmed to what playback needs. `allow` already grants fullscreen;
          // a separate `allowFullScreen` is redundant and makes Chrome warn.
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        />
      </Box>
    );
  }

  const showPoster = !!poster && !posterFailed;
  return (
    <Box style={FRAME_STYLE}>
      <button
        type="button"
        aria-label={`Play ${title} (loads the ${site} player)`}
        title={`Loads the ${site} player`}
        onClick={(evt) => {
          evt.stopPropagation();
          setActive(true);
        }}
        style={{
          ...FILL_STYLE,
          padding: 0,
          cursor: 'pointer',
          background: color.SurfaceVariant.Container,
          color: color.SurfaceVariant.OnContainer,
        }}
      >
        {showPoster && (
          <img
            src={poster}
            alt=""
            referrerPolicy="no-referrer"
            draggable={false}
            onError={() => setPosterFailed(true)}
            style={{ ...FILL_STYLE, objectFit: 'cover' }}
          />
        )}
        <Box
          direction="Column"
          alignItems="Center"
          justifyContent="Center"
          gap="200"
          style={{
            ...FILL_STYLE,
            padding: config.space.S400,
            background: showPoster ? 'rgba(0, 0, 0, 0.35)' : undefined,
            color: showPoster ? '#fff' : undefined,
          }}
        >
          <Box
            alignItems="Center"
            justifyContent="Center"
            style={{
              width: toRem(56),
              height: toRem(56),
              borderRadius: '50%',
              background: 'rgba(0, 0, 0, 0.6)',
              color: '#fff',
            }}
          >
            <Icon src={Icons.Play} size="400" filled />
          </Box>
          <Text size="T300" truncate style={{ maxWidth: '100%', color: 'inherit' }}>
            {title}
          </Text>
          <Text size="T200" style={{ color: 'inherit', opacity: 0.8 }}>
            Play on {site}
          </Text>
        </Box>
      </button>
    </Box>
  );
}
