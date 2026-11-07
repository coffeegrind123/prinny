import { ComponentProps, useCallback, useEffect, useState } from 'react';
import { Box, Button, Icon, Icons, Text, as, config } from 'folds';
import { AsyncStatus, useAsyncCallback } from '../../hooks/useAsyncCallback';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { tryDecodeURIComponent } from '../../utils/dom';
import { webUrlOrUndefined } from '../../utils/safeUrl';
import { isMediaRevealed, revealMedia } from '../../utils/mediaConsent';
import { UrlPreview, UrlPreviewContent } from './UrlPreview';
import { UrlPreviewCard } from './UrlPreviewCard';

const DESCRIPTION_MAX_CHARS = 300;

const ogString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

type GatedUrlPreviewCardProps = ComponentProps<typeof UrlPreviewCard> & {
  /**
   * False when MSC4278 or "Disable Media Auto Load" keeps media in this room
   * behind a click. The card then shows only the homeserver's text preview:
   * no og:image, and none of UrlPreviewCard's embeds, each of which loads
   * media or calls a third-party API the sender's link chose.
   */
  mediaPreviews?: boolean;
};

/**
 * Consent is keyed by the link, like attachments are keyed by mxc, so a card
 * the user opened stays open when the timeline re-mounts it.
 */
const consentKey = (url: string): string => `url:${url}`;

const TextOnlyUrlPreview = as<'div', { url: string; ts: number; onShowMedia: () => void }>(
  ({ url, ts, onShowMedia, ...props }, ref) => {
    const mx = useMatrixClient();
    const safeUrl = webUrlOrUndefined(url);

    const [previewState, loadPreview] = useAsyncCallback(
      useCallback(() => mx.getUrlPreview(url, ts), [mx, url, ts]),
    );

    useEffect(() => {
      // The rejection is kept in `previewState`; the card then shows the bare link.
      loadPreview().catch(() => undefined);
    }, [loadPreview]);

    const preview = previewState.status === AsyncStatus.Success ? previewState.data : undefined;
    const siteName = ogString(preview?.['og:site_name']);
    const title = ogString(preview?.['og:title']);
    const rawDescription = ogString(preview?.['og:description']);
    const description =
      rawDescription && rawDescription.length > DESCRIPTION_MAX_CHARS
        ? `${rawDescription.slice(0, DESCRIPTION_MAX_CHARS)}…`
        : rawDescription;

    return (
      <UrlPreview {...props} ref={ref}>
        <UrlPreviewContent>
          <Text
            truncate
            as="a"
            href={safeUrl}
            target="_blank"
            rel="noreferrer"
            size="T200"
            priority="300"
          >
            {siteName ? `${siteName} | ` : ''}
            {tryDecodeURIComponent(url)}
          </Text>
          {title && (
            <Text
              style={{ fontWeight: '600' }}
              as="a"
              href={safeUrl}
              target="_blank"
              rel="noreferrer"
              size="T300"
              truncate
            >
              {title}
            </Text>
          )}
          {description && (
            <Text size="T200" priority="300" style={{ whiteSpace: 'pre-wrap' }}>
              {description}
            </Text>
          )}
          <Box style={{ marginTop: config.space.S100 }}>
            <Button
              variant="Secondary"
              fill="Soft"
              size="300"
              radii="300"
              onClick={onShowMedia}
              before={<Icon size="50" src={Icons.Photo} />}
            >
              <Text size="B300">Show media</Text>
            </Button>
          </Box>
        </UrlPreviewContent>
      </UrlPreview>
    );
  },
);

export function GatedUrlPreviewCard({ mediaPreviews, ...props }: GatedUrlPreviewCardProps) {
  const { url, ts } = props;
  const [consented, setConsented] = useState(() => isMediaRevealed(consentKey(url)));

  if (mediaPreviews !== false || consented) {
    return <UrlPreviewCard {...props} />;
  }

  return (
    <TextOnlyUrlPreview
      url={url}
      ts={ts}
      onShowMedia={() => {
        revealMedia(consentKey(url));
        setConsented(true);
      }}
    />
  );
}
