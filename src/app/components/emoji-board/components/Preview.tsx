import { Box, Text } from 'folds';
import { Atom, atom, useAtomValue } from 'jotai';
import * as css from './styles.css';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { mxcUrlToHttp } from '../../../utils/matrix';

export type PreviewData = {
  key: string;
  shortcode: string;
};

/**
 * A preview key is either something to draw as text — a unicode emoji — or
 * somewhere to fetch a picture from. Mashups add the third case: an
 * `https://` thumbnail that exists at Google before it exists on the
 * homeserver, and is only uploaded once picked.
 */
const isImageKey = (key: string): boolean =>
  key.startsWith('mxc://') || key.startsWith('https://') || key.startsWith('http://');

export const createPreviewDataAtom = (initial?: PreviewData) =>
  atom<PreviewData | undefined>(initial);

type PreviewProps = {
  previewAtom: Atom<PreviewData | undefined>;
};
export function Preview({ previewAtom }: PreviewProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();

  const { key, shortcode } = useAtomValue(previewAtom) ?? {};

  if (!shortcode) return null;

  return (
    <Box shrink="No" className={css.Preview} gap="300" alignItems="Center">
      {key && (
        <Box
          display="InlineFlex"
          className={css.PreviewEmoji}
          alignItems="Center"
          justifyContent="Center"
        >
          {isImageKey(key) ? (
            <img
              className={css.PreviewImg}
              src={
                key.startsWith('mxc://') ? (mxcUrlToHttp(mx, key, useAuthentication) ?? key) : key
              }
              alt={shortcode}
            />
          ) : (
            key
          )}
        </Box>
      )}
      <Text size="H5" truncate>
        :{shortcode}:
      </Text>
    </Box>
  );
}
