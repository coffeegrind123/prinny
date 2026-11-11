import { useState } from 'react';
import { Box, IconButton } from 'folds';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';
import {
  EMOJI_SKIN_TONES,
  findEmojiByUnicode,
  getEmojiUnicodeForTone,
} from '../../../plugins/emoji';

const SAMPLE = findEmojiByUnicode('✋');
const sample = (tone: number): string => (SAMPLE ? getEmojiUnicodeForTone(SAMPLE, tone) : '✋');
const TONE_LABELS = ['Default', 'Light', 'Medium-light', 'Medium', 'Medium-dark', 'Dark'];

/**
 * The skin tone for emoji that have one: a hand that opens a row of swatches. It applies to the
 * grid, search results, Frequently Used and the `:` autocomplete, and to what is sent.
 */
export function SkinToneSelector() {
  const [skinTone, setSkinTone] = useSetting(settingsAtom, 'emojiSkinTone');
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <IconButton
        variant="SurfaceVariant"
        size="400"
        radii="300"
        aria-label={`Skin tone: ${TONE_LABELS[skinTone] ?? TONE_LABELS[0]}`}
        title="Skin tone"
        onClick={() => setOpen(true)}
      >
        <span aria-hidden>{sample(skinTone)}</span>
      </IconButton>
    );
  }

  return (
    <Box shrink="No" gap="100" alignItems="Center" role="group" aria-label="Skin tone">
      {EMOJI_SKIN_TONES.map((tone) => (
        <IconButton
          key={tone}
          variant={tone === skinTone ? 'Primary' : 'SurfaceVariant'}
          size="400"
          radii="300"
          aria-label={TONE_LABELS[tone]}
          aria-pressed={tone === skinTone}
          title={TONE_LABELS[tone]}
          onClick={() => {
            setSkinTone(tone);
            setOpen(false);
          }}
        >
          <span aria-hidden>{sample(tone)}</span>
        </IconButton>
      ))}
    </Box>
  );
}
