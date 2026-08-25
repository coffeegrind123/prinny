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
  KitchenCombo,
  KitchenEmoji,
  findKitchenEmoji,
  kitchenEmojis,
  kitchenPartners,
  mashupLabel,
  mashupShortcode,
} from '../../plugins/emoji-kitchen';
import { useMashupUpload } from './useMashupUpload';

const RECENT_GROUP_ID = 'mashup_recent';
const RESULT_GROUP_ID = 'mashup_results';

/** 😀 if Google drew it, otherwise whatever the roster starts with. */
const defaultSubject = (): KitchenEmoji | undefined =>
  findKitchenEmoji('1f600') ?? kitchenEmojis[0];

const matchesQuery = (subject: KitchenEmoji, query: string): boolean => {
  if (!query) return true;
  const needle = query.toLowerCase();
  if (subject.emoji.label.toLowerCase().includes(needle)) return true;
  const shortcodes = Array.isArray(subject.emoji.shortcodes)
    ? subject.emoji.shortcodes
    : [subject.emoji.shortcode];
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
 * Picks a Google Emoji Kitchen pairing and hands back an `mxc://` for it.
 *
 * A strip of emoji along the top chooses one half; below it is every pairing
 * Google actually drew for that emoji, shown as the finished artwork. Only real
 * pairings are listed — Kitchen covers 147,000 of the 619×619 possibilities, so
 * a grid of every combination would be mostly dead ends.
 *
 * The thumbnails come straight from `gstatic.com`. Nothing is uploaded until a
 * pairing is picked.
 */
export function MashupPicker({ previewAtom, onMashupSelect, requestClose }: MashupPickerProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const setPreview = useSetAtom(previewAtom);
  const uploadMashup = useMashupUpload();
  const stored = useStoredMashups();
  const { isPinned, togglePin } = useMashupPinning();

  const [subjectCodepoint, setSubjectCodepoint] = useState<string | undefined>(
    () => stored[0]?.left ?? defaultSubject()?.codepoint,
  );
  const [query, setQuery] = useState('');
  const [busyShortcode, setBusyShortcode] = useState<string>();
  const [error, setError] = useState<string>();

  const subject = useMemo(
    () => (subjectCodepoint ? findKitchenEmoji(subjectCodepoint) : undefined) ?? defaultSubject(),
    [subjectCodepoint],
  );

  const choices = useMemo(() => {
    const matching = kitchenEmojis.filter((item) => matchesQuery(item, query));
    // The chosen emoji stays reachable even when the query excludes it —
    // otherwise searching silently changes what you are mashing.
    if (subject && !matching.some((item) => item.index === subject.index)) {
      return [subject, ...matching];
    }
    return matching;
  }, [query, subject]);

  const combos = useMemo(() => {
    if (!subject) return [];
    const all = kitchenPartners(subject);
    if (!query) return all;
    return all.filter((combo) => matchesQuery(combo.partner, query));
  }, [subject, query]);

  const handleQueryChange: ChangeEventHandler<HTMLInputElement> = (evt) => {
    setQuery(evt.target.value.trim());
  };

  const handlePick = useCallback(
    async (combo: KitchenCombo) => {
      if (!subject || busyShortcode) return;
      const shortcode = mashupShortcode(subject, combo.partner);
      setBusyShortcode(shortcode);
      setError(undefined);
      try {
        const { mxc } = await uploadMashup(subject, combo.partner, combo.url);
        onMashupSelect(mxc, shortcode);
        requestClose();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'That mashup could not be uploaded. Try again.',
        );
      } finally {
        setBusyShortcode(undefined);
      }
    },
    [subject, busyShortcode, uploadMashup, onMashupSelect, requestClose],
  );

  const handlePickStored = useCallback(
    (mashup: StoredMashup) => {
      // Already uploaded, so this is only a re-use plus a bump of the recent
      // order. Nothing is awaited: the URI is the part that matters and it is
      // in hand.
      rememberMashup(mx, {
        shortcode: mashup.shortcode,
        left: mashup.left,
        right: mashup.right,
        mxc: mashup.mxc,
        body: mashup.body,
        info: mashup.info,
      });
      onMashupSelect(mashup.mxc, mashup.shortcode);
      requestClose();
    },
    [mx, onMashupSelect, requestClose],
  );

  const storedLabel = useCallback((mashup: StoredMashup): string => {
    const left = findKitchenEmoji(mashup.left);
    const right = findKitchenEmoji(mashup.right);
    // A mashup made by the previous engine has halves Kitchen does not know;
    // its stored description is still exactly right.
    if (left && right) return mashupLabel(left, right);
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

      <Box className={css.MashupChoiceStrip} shrink="No">
        {choices.map((item) => (
          <Box
            key={item.codepoint}
            as="button"
            type="button"
            alignItems="Center"
            justifyContent="Center"
            className={classNames(
              css.MashupChoiceBtn,
              item.index === subject?.index && css.MashupChoiceBtnActive,
            )}
            title={item.emoji.label}
            aria-label={`Mash ${item.emoji.label}`}
            aria-pressed={item.index === subject?.index}
            onClick={() => setSubjectCodepoint(item.codepoint)}
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
                    onHover={() => setPreview({ key: mashup.mxc, shortcode: mashup.shortcode })}
                    pin={{
                      pinned: isPinned(mashup.shortcode),
                      onToggle: () => togglePin(mashup),
                    }}
                  />
                ))}
              </EmojiGroup>
            )}

            {subject && (
              <EmojiGroup
                id={RESULT_GROUP_ID}
                label={
                  combos.length > 0
                    ? `${subject.emoji.unicode} + … (${combos.length})`
                    : 'No pairings match that search'
                }
              >
                {combos.map((combo) => {
                  const shortcode = mashupShortcode(subject, combo.partner);
                  return (
                    <MashupTile
                      key={combo.partner.codepoint}
                      src={combo.url}
                      shortcode={shortcode}
                      label={mashupLabel(subject, combo.partner)}
                      busy={busyShortcode === shortcode}
                      onPick={() => handlePick(combo)}
                      onHover={() => setPreview({ key: combo.url, shortcode })}
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
