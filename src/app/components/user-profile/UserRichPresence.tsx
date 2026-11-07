import { MouseEventHandler, useEffect, useState } from 'react';
import { Box, Button, color, config, Icon, IconButton, Icons, ProgressBar, Text } from 'folds';
import {
  RichPresence,
  RichPresenceButton,
  RichPresenceProgress,
  resolveButtonUrl,
} from '../../../types/matrix/richPresence';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { mxcUrlToHttp } from '../../utils/matrix';
import { SequenceCard } from '../sequence-card';
import { UrlConfirmDialog } from '../UrlConfirmDialog';
import * as css from './styles.css';

const formatDuration = (seconds: number): string => {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(wholeSeconds / 60);
  return `${minutes}:${String(wholeSeconds % 60).padStart(2, '0')}`;
};

const getCompletedSeconds = (progress: RichPresenceProgress, now: number): number => {
  if (progress.complete !== undefined) return Math.min(progress.complete, progress.length);
  if (progress.timeComplete === undefined) return 0;

  const completionTs =
    progress.timeComplete > 1_000_000_000_000
      ? progress.timeComplete / 1000
      : progress.timeComplete;
  if (completionTs < 1_000_000_000) return Math.min(completionTs, progress.length);

  return Math.min(Math.max(progress.length - (completionTs - now / 1000), 0), progress.length);
};

type MediaProgressProps = {
  progress: RichPresenceProgress;
};
function MediaProgress({ progress }: MediaProgressProps) {
  const [now, setNow] = useState(Date.now());
  const isTimestamp =
    progress.complete === undefined &&
    progress.timeComplete !== undefined &&
    progress.timeComplete >= 1_000_000_000;

  useEffect(() => {
    if (!isTimestamp) return undefined;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [isTimestamp]);

  const completed = getCompletedSeconds(progress, now);

  return (
    <Box alignItems="Center" gap="200">
      <Text size="T200" priority="300">
        {formatDuration(completed)}
      </Text>
      <Box grow="Yes">
        <ProgressBar
          aria-label="Track progress"
          variant="Primary"
          size="300"
          min={0}
          max={progress.length}
          value={completed}
          style={{ width: '100%' }}
        />
      </Box>
      <Text size="T200" priority="300">
        {formatDuration(progress.length)}
      </Text>
    </Box>
  );
}

const getExternalUrl = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch {
    return undefined;
  }
};

const PRESENCE_LINK_INTRO = "This link comes from someone's activity status. It goes to:";

const OPENID_CONSEQUENCES =
  'The site will learn your Matrix ID and server, can link this visit to your account, and sees your IP address and browser details when you open it.';

const OPENID_WARNING = (
  <Text size="T200" style={{ color: color.Critical.Main }}>
    Continuing asks your homeserver for a token that proves you are this Matrix account, and puts it
    in the link. {OPENID_CONSEQUENCES}
  </Text>
);

const OPENID_TOKEN_WARNING = (
  <Text size="T200" style={{ color: color.Critical.Main }}>
    This link now contains a token that proves you are this Matrix account. {OPENID_CONSEQUENCES}
  </Text>
);

type PresenceButtonDialogProps = {
  button: RichPresenceButton;
  onDone: () => void;
};

/**
 * MSC4544's prompt for a button: the full URL on every click, never
 * remembered. An OpenID button takes two steps. The first discloses the token
 * request and nothing is requested until the user agrees; the second shows
 * the URL with the token filled in, and opening it is a fresh click (which is
 * also what keeps a browser from blocking the new window after the wait).
 */
function PresenceButtonDialog({ button, onDone }: PresenceButtonDialogProps) {
  const mx = useMatrixClient();
  const [resolved, setResolved] = useState<string | undefined>(
    button.requestOpenId ? undefined : button.url,
  );
  const [requesting, setRequesting] = useState(false);
  const [failed, setFailed] = useState(false);

  const open = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
    onDone();
  };

  if (resolved !== undefined) {
    return (
      <UrlConfirmDialog
        url={resolved}
        intro={PRESENCE_LINK_INTRO}
        warning={button.requestOpenId ? OPENID_TOKEN_WARNING : undefined}
        onConfirm={() => open(resolved)}
        onCancel={onDone}
      />
    );
  }

  const requestToken = async () => {
    setRequesting(true);
    setFailed(false);
    try {
      const token = await mx.getOpenIdToken();
      setResolved(resolveButtonUrl(button.url, token));
    } catch {
      setFailed(true);
    } finally {
      setRequesting(false);
    }
  };

  return (
    <UrlConfirmDialog
      url={button.url}
      intro={PRESENCE_LINK_INTRO}
      warning={
        <>
          {OPENID_WARNING}
          {failed && (
            <Text size="T200" style={{ color: color.Critical.Main }}>
              Your homeserver did not issue a token.
            </Text>
          )}
        </>
      }
      confirmLabel="Request token"
      busy={requesting}
      onConfirm={requestToken}
      onCancel={onDone}
    />
  );
}

type UserRichPresenceProps = {
  presence: RichPresence;
};
export function UserRichPresence({ presence }: UserRichPresenceProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const imageMxc = presence.type === 'media' ? presence.coverArt : presence.image;
  const imageUrl = imageMxc
    ? (mxcUrlToHttp(mx, imageMxc, useAuthentication, 96, 96, 'crop') ?? undefined)
    : undefined;
  const [imageStatus, setImageStatus] = useState<'loading' | 'loaded' | 'error'>(
    imageUrl ? 'loading' : 'error',
  );

  useEffect(() => {
    setImageStatus(imageUrl ? 'loading' : 'error');
  }, [imageUrl]);

  const externalUrl = getExternalUrl(
    presence.type === 'media' ? presence.streamingLink : undefined,
  );

  // The streaming link is written by another user, so it is confirmed before
  // it is followed — same rule, and the same dialog, as a bot-supplied URL.
  // The dialog shows the host, which is the only part of a link its author
  // cannot misrepresent.
  const [confirmingUrl, setConfirmingUrl] = useState<string | null>(null);
  const [confirmingButton, setConfirmingButton] = useState<RichPresenceButton | null>(null);

  const handleExternalLink: MouseEventHandler<HTMLAnchorElement> = (event) => {
    if (!externalUrl) return;
    event.preventDefault();
    setConfirmingUrl(externalUrl);
  };

  return (
    <SequenceCard
      variant="SurfaceVariant"
      direction="Column"
      gap="300"
      style={{ padding: config.space.S300 }}
    >
      <Box alignItems="Center" gap="200">
        <Box grow="Yes">
          <Text size="L400" priority="300" truncate>
            {presence.type === 'media' ? `Listening to ${presence.player ?? 'music'}` : 'Playing'}
          </Text>
        </Box>
        {externalUrl && (
          <IconButton
            as="a"
            href={externalUrl}
            target="_blank"
            rel="noreferrer noopener"
            onClick={handleExternalLink}
            aria-label="Open track"
            title="Open track"
            size="300"
            variant="Secondary"
            fill="None"
            radii="Pill"
          >
            <Icon src={Icons.External} size="50" />
          </IconButton>
        )}
      </Box>
      <Box gap="300" alignItems="Stretch">
        <div className={css.RichPresenceArtwork}>
          {imageUrl ? (
            <>
              <img
                className={css.RichPresenceImage}
                src={imageUrl}
                alt=""
                draggable="false"
                style={imageStatus === 'loaded' ? undefined : { display: 'none' }}
                onLoad={() => setImageStatus('loaded')}
                onError={() => setImageStatus('error')}
              />
              {imageStatus !== 'loaded' && <Icon src={Icons.Play} size="300" filled />}
            </>
          ) : (
            <Icon src={Icons.Play} size="300" filled />
          )}
        </div>
        <Box direction="Column" gap="100" grow="Yes" justifyContent="Center">
          <Text
            size="L400"
            truncate
            title={presence.type === 'media' ? presence.track : presence.name}
          >
            {presence.type === 'media' ? presence.track : presence.name}
          </Text>
          {presence.type === 'media' ? (
            <>
              {presence.artist && (
                <Text size="T300" priority="300" truncate title={presence.artist}>
                  {presence.artist}
                </Text>
              )}
              {presence.album && (
                <Text size="T200" priority="300" truncate title={presence.album}>
                  {presence.album}
                </Text>
              )}
              {presence.progress && <MediaProgress progress={presence.progress} />}
            </>
          ) : (
            presence.details && (
              <Text size="T200" priority="300">
                {presence.details}
              </Text>
            )
          )}
        </Box>
      </Box>
      {presence.buttons && (
        <Box gap="200" wrap="Wrap">
          {presence.buttons.map((button) => (
            <Button
              key={`${button.label}\n${button.url}`}
              size="300"
              variant="Secondary"
              fill="Soft"
              radii="300"
              title={button.url}
              onClick={() => setConfirmingButton(button)}
              after={<Icon src={Icons.External} size="50" />}
            >
              <Text size="B300" truncate>
                {button.label}
              </Text>
            </Button>
          ))}
        </Box>
      )}
      {confirmingButton && (
        <PresenceButtonDialog button={confirmingButton} onDone={() => setConfirmingButton(null)} />
      )}
      {confirmingUrl && (
        <UrlConfirmDialog
          url={confirmingUrl}
          intro={PRESENCE_LINK_INTRO}
          onConfirm={() => {
            window.open(confirmingUrl, '_blank', 'noopener,noreferrer');
            setConfirmingUrl(null);
          }}
          onCancel={() => setConfirmingUrl(null)}
        />
      )}
    </SequenceCard>
  );
}
