import { ChangeEventHandler, MouseEventHandler, useCallback, useMemo, useState } from 'react';
import { Box, Icon, Icons, Input, Scroll, Spinner, Text } from 'folds';
import classNames from 'classnames';
import { PrimitiveAtom, useSetAtom } from 'jotai';
import * as css from './components/styles.css';
import { EmojiGroup, PreviewData } from './components';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { mxcUrlToHttp } from '../../utils/matrix';
import { mobileOrTablet } from '../../utils/user-agent';
import { StoredMashup, rememberMashup, useStoredMashups } from '../../state/emojiMashups';
import { useMashupPinning } from '../../hooks/useMashupImagePack';
import {
  MashupEmoji,
  findMashupFace,
  findMashupMouth,
  mashupDataUri,
  mashupFaces,
  mashupLabel,
  mashupMouths,
  mashupShortcode,
} from '../../plugins/emoji-mashup';
import { useMashupUpload } from './useMashupUpload';

const RECENT_GROUP_ID = 'mashup_recent';
const RESULT_GROUP_ID = 'mashup_results';

/** 😀 if the parts are there, otherwise whatever the roster starts with. */
const defaultFace = (): MashupEmoji | undefined =>
  findMashupFace('1f600') ?? mashupFaces[0];

const matchesQuery = (emoji: MashupEmoji, query: string): boolean => {
  if (!query) return true;
  const needle = query.toLowerCase();
  if (emoji.emoji.label.toLowerCase().includes(needle)) return true;
  const shortcodes = Array.isArray(emoji.emoji.shortcodes)
    ? emoji.emoji.shortcodes
    : [emoji.emoji.shortcode];
  return shortcodes.some((shortcode) => shortcode.toLowerCase().includes(needle));
};

type MashupTileProps = {
  src: string;
  shortcode: string;
  label: string;
  busy: boolean;
  onPick: () => void;
  onHover: () => void;
  pin?: {
    pinned: boolean;
    onToggle: () => void;
  };
};

function MashupTile({ src, shortcode, label, busy, onPick, onHover, pin }: MashupTileProps) {
  const handlePinClick: MouseEventHandler = (evt) => {
    // The tile underneath sends; the badge must not.
    evt.stopPropagation();
    pin?.onToggle();
  };

  return (
    <Box
      as="button"
      type="button"
      alignItems="Center"
      justifyContent="Center"
      className={classNames(css.MashupItem, busy && css.MashupItemBusy)}
      title={label}
      aria-label={`${label} mashup`}
      aria-busy={busy}
      disabled={busy}
      onClick={onPick}
      onMouseEnter={onHover}
      onFocus={onHover}
    >
      {busy ? (
        <Spinner variant="Secondary" size="200" />
      ) : (
        <img className={css.MashupImg} src={src} alt={shortcode} loading="lazy" />
      )}
      {pin && (
        <Box
          as="span"
          role="button"
          tabIndex={0}
          alignItems="Center"
          justifyContent="Center"
          className={classNames(css.MashupPinBtn, pin.pinned && css.MashupPinBtnActive)}
          title={pin.pinned ? 'Remove from your emoji' : 'Add to your emoji'}
          aria-label={pin.pinned ? 'Remove from your emoji' : 'Add to your emoji'}
          aria-pressed={pin.pinned}
          onClick={handlePinClick}
          onKeyDown={(evt) => {
            if (evt.key === 'Enter' || evt.key === ' ') {
              evt.preventDefault();
              evt.stopPropagation();
              pin.onToggle();
            }
          }}
        >
          <Icon src={Icons.Bookmark} size="50" />
        </Box>
      )}
    </Box>
  );
}

export type MashupPickerProps = {
  previewAtom: PrimitiveAtom<PreviewData | undefined>;
  /** Receives the uploaded `mxc://` and the mashup's shortcode, in that order —
   *  the same shape as the board's custom emoji callback, so a mashup can be
   *  sent or reacted with by whatever already handles a custom emoji. */
  onMashupSelect: (mxc: string, shortcode: string) => void;
  requestClose: () => void;
};

/**
 * Builds a new emoji out of two, then hands back an `mxc://` for it.
 *
 * The layout follows what the tab is for: one strip of faces along the top to
 * choose the half that donates the head and eyes, and below it every mashup
 * that face makes, drawn for real. You pick from finished pictures rather than
 * from a second list of names.
 */
export function MashupPicker({ previewAtom, onMashupSelect, requestClose }: MashupPickerProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const setPreview = useSetAtom(previewAtom);
  const uploadMashup = useMashupUpload();
  const stored = useStoredMashups();
  const { isPinned, togglePin } = useMashupPinning();

  const [faceCodepoint, setFaceCodepoint] = useState<string | undefined>(
    () => stored[0]?.face ?? defaultFace()?.codepoint
  );
  const [query, setQuery] = useState('');
  const [busyShortcode, setBusyShortcode] = useState<string>();
  const [error, setError] = useState<string>();

  const face = useMemo(
    () => (faceCodepoint ? findMashupFace(faceCodepoint) : undefined) ?? defaultFace(),
    [faceCodepoint]
  );

  const faces = useMemo(() => {
    const matching = mashupFaces.filter((item) => matchesQuery(item, query));
    // The chosen face stays reachable even when the query excludes it —
    // otherwise searching for a mouth silently changes what you are mashing.
    if (face && !matching.some((item) => item.codepoint === face.codepoint)) {
      return [face, ...matching];
    }
    return matching;
  }, [query, face]);

  const mouths = useMemo(
    () => mashupMouths.filter((item) => matchesQuery(item, query)),
    [query]
  );

  const handleQueryChange: ChangeEventHandler<HTMLInputElement> = (evt) => {
    setQuery(evt.target.value.trim());
  };

  const handlePick = useCallback(
    async (mouth: MashupEmoji) => {
      if (!face || busyShortcode) return;
      const shortcode = mashupShortcode(face, mouth);
      setBusyShortcode(shortcode);
      setError(undefined);
      try {
        const { mxc } = await uploadMashup(face, mouth);
        onMashupSelect(mxc, shortcode);
        requestClose();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'That mashup could not be uploaded. Try again.'
        );
      } finally {
        setBusyShortcode(undefined);
      }
    },
    [face, busyShortcode, uploadMashup, onMashupSelect, requestClose]
  );

  const handlePickStored = useCallback(
    (mashup: StoredMashup) => {
      // Already uploaded, so this is only a re-use plus a bump of the recent
      // order. Nothing is awaited: the URI is the part that matters and it is
      // in hand.
      rememberMashup(mx, {
        shortcode: mashup.shortcode,
        face: mashup.face,
        mouth: mashup.mouth,
        mxc: mashup.mxc,
        body: mashup.body,
        info: mashup.info,
      });
      onMashupSelect(mashup.mxc, mashup.shortcode);
      requestClose();
    },
    [mx, onMashupSelect, requestClose]
  );

  const storedLabel = useCallback((mashup: StoredMashup): string => {
    const storedFace = findMashupFace(mashup.face);
    const storedMouth = findMashupMouth(mashup.mouth);
    if (storedFace && storedMouth) return mashupLabel(storedFace, storedMouth);
    return mashup.body;
  }, []);

  return (
    <Box className={css.MashupPicker} direction="Column" grow="Yes">
      <Box className={css.MashupToolbar} shrink="No" direction="Column">
        <Input
          variant="SurfaceVariant"
          size="400"
          placeholder="Search emoji"
          maxLength={50}
          after={<Icon src={Icons.Search} size="50" />}
          onChange={handleQueryChange}
          autoFocus={!mobileOrTablet()}
        />
      </Box>

      <Box className={css.MashupFaceStrip} shrink="No">
        {faces.map((item) => (
          <Box
            key={item.codepoint}
            as="button"
            type="button"
            alignItems="Center"
            justifyContent="Center"
            className={classNames(
              css.MashupFaceBtn,
              item.codepoint === face?.codepoint && css.MashupFaceBtnActive
            )}
            title={item.emoji.label}
            aria-label={`Mash ${item.emoji.label}`}
            aria-pressed={item.codepoint === face?.codepoint}
            onClick={() => setFaceCodepoint(item.codepoint)}
          >
            {item.emoji.unicode}
          </Box>
        ))}
      </Box>

      <Box grow="Yes" className={css.MashupScrollWrap}>
        <Scroll size="400" hideTrack>
          <Box direction="Column">
            {error && (
              <Box className={css.MashupStatus} justifyContent="Center">
                <Text size="T300" style={{ textAlign: 'center' }}>
                  {error}
                </Text>
              </Box>
            )}

            {stored.length > 0 && !query && (
              <EmojiGroup id={RECENT_GROUP_ID} label="Recent">
                {stored.map((mashup) => (
                  <MashupTile
                    key={mashup.shortcode}
                    src={mxcUrlToHttp(mx, mashup.mxc, useAuthentication) ?? mashup.mxc}
                    shortcode={mashup.shortcode}
                    label={storedLabel(mashup)}
                    busy={false}
                    onPick={() => handlePickStored(mashup)}
                    onHover={() =>
                      setPreview({ key: mashup.mxc, shortcode: mashup.shortcode })
                    }
                    pin={{
                      pinned: isPinned(mashup.shortcode),
                      onToggle: () => togglePin(mashup),
                    }}
                  />
                ))}
              </EmojiGroup>
            )}

            {face && (
              <EmojiGroup
                id={RESULT_GROUP_ID}
                label={
                  mouths.length > 0
                    ? `${face.emoji.unicode} + …`
                    : 'No emoji match that search'
                }
              >
                {mouths.map((mouth) => {
                  const uri = mashupDataUri(face.codepoint, mouth.codepoint);
                  if (!uri) return null;
                  const shortcode = mashupShortcode(face, mouth);
                  return (
                    <MashupTile
                      key={mouth.codepoint}
                      src={uri}
                      shortcode={shortcode}
                      label={mashupLabel(face, mouth)}
                      busy={busyShortcode === shortcode}
                      onPick={() => handlePick(mouth)}
                      onHover={() => setPreview({ key: uri, shortcode })}
                    />
                  );
                })}
              </EmojiGroup>
            )}
          </Box>
        </Scroll>
      </Box>
    </Box>
  );
}

export default MashupPicker;
