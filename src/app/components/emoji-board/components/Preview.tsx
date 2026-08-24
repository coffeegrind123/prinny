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
          {key.startsWith('mxc://') || key.startsWith('data:') ? (
            <img
              className={css.PreviewImg}
              // A mashup previews from a `data:` URI: it exists as markup
              // before it exists on the homeserver, and is only uploaded once
              // the user picks it.
              src={
                key.startsWith('data:')
                  ? key
                  : mxcUrlToHttp(mx, key, useAuthentication) ?? key
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
