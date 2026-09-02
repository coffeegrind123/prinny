import { ReactNode, useEffect, useRef, useState } from 'react';
import { Box, Chip, Spinner, Text, Tooltip, TooltipProvider, as } from 'folds';
import classNames from 'classnames';
import { BlurhashCanvas } from '../../BlurhashCanvas';
import { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import {
  IThumbnailContent,
  IVideoInfo,
  MATRIX_BLUR_HASH_PROPERTY_NAME,
} from '../../../../types/matrix/common';
import * as css from './style.css';
import { AsyncStatus } from '../../../hooks/useAsyncCallback';
import { useMediaSrc } from '../../../hooks/useMediaSrc';
import { useHoverPlay } from '../../../hooks/useHoverPlay';
import { validBlurHash } from '../../../utils/blurHash';
import { Video } from '../../media';

type VideoContentProps = {
  body: string;
  /** Sender's filename, so a save from the element's own menu keeps it. */
  filename?: string;
  mimeType: string;
  url: string;
  info: IVideoInfo & IThumbnailContent;
  encInfo?: EncryptedAttachmentInfo;
  /**
   * Sent from the GIF picker, or otherwise marked as a GIF by the sender.
   *
   * A GIF is a moving image, not a video someone chose to watch: it loops, it
   * is silent, and a transport bar under it is furniture. Everything else gets
   * ordinary player controls and stays paused until asked.
   */
  gif?: boolean;
  markedAsSpoiler?: boolean;
  spoilerReason?: string;
  renderThumbnail?: () => ReactNode;
  /**
   * Chrome drawn over the top-right of the player. The media feed's entry
   * point lives here: a video in the timeline plays in place, and this is what
   * takes it full-screen alongside the rest of the room's media.
   */
  renderOverlay?: () => ReactNode;
};

/**
 * A video attachment, played by the browser's own video element.
 *
 * This used to drive a hand-built player: a "Watch" button that had to be
 * pressed before anything loaded, a manual fetch of the whole file into a blob,
 * duration and size badges painted over the corner, and autoplay-with-loop once
 * it finally started — which is GIF behaviour, applied to every video including
 * hour-long ones. Meanwhile the audio side had already been reduced to a native
 * element over `useMediaSrc`, and video simply never followed.
 *
 * It follows now, and inherits what that hook already gets right: plain media
 * streams from a URL instead of being downloaded in full before it can start,
 * and only encrypted or authenticated media takes the blob path. `preload` is
 * "metadata", so a timeline full of videos costs a few headers rather than the
 * files themselves — which is what the Watch gate was really for.
 */
export const VideoContent = as<'div', VideoContentProps>(
  (
    {
      className,
      body,
      filename,
      mimeType,
      url,
      info,
      encInfo,
      gif,
      markedAsSpoiler,
      spoilerReason,
      renderThumbnail,
      renderOverlay,
      ...props
    },
    ref,
  ) => {
    const { src, state, needsBlob, onSrcError } = useMediaSrc(url, mimeType, encInfo, filename);
    const blurHash = validBlurHash(info.thumbnail_info?.[MATRIX_BLUR_HASH_PROPERTY_NAME]);
    // In low animation mode a GIF holds still until pointed at or focused.
    // `hoverProps` is empty when the mode is off, so this costs nothing then.
    const { lowAnimationMode, hovered, hoverProps } = useHoverPlay();
    const videoRef = useRef<HTMLVideoElement>(null);

    const [blurred, setBlurred] = useState(markedAsSpoiler ?? false);
    // Set when the browser refuses to autoplay. Linux and Android both do, and
    // a looping GIF has no play button of its own, so without this it sits
    // there as a dead still frame with no way to start it.
    const [playbackRefused, setPlaybackRefused] = useState(false);

    const autoPlay = !!gif && !lowAnimationMode;

    useEffect(() => {
      const video = videoRef.current;
      if (!gif || !lowAnimationMode || !video) return;
      if (hovered) {
        video.play().catch(() => setPlaybackRefused(true));
      } else {
        video.pause();
        video.currentTime = 0;
      }
    }, [gif, lowAnimationMode, hovered]);

    useEffect(() => {
      const video = videoRef.current;
      if (!autoPlay || !video || !src) return;
      video.play().catch(() => setPlaybackRefused(true));
    }, [autoPlay, src]);

    if (needsBlob && state.status === AsyncStatus.Error) {
      return (
        <Box
          className={classNames(css.RelativeBase, className)}
          alignItems="Center"
          justifyContent="Center"
          {...props}
          ref={ref}
        >
          <Text size="T200" priority="300">
            Failed to load video.
          </Text>
        </Box>
      );
    }

    return (
      <Box className={classNames(css.RelativeBase, className)} {...hoverProps} {...props} ref={ref}>
        {typeof blurHash === 'string' && (
          <BlurhashCanvas
            style={{ width: '100%', height: '100%' }}
            width={32}
            height={32}
            hash={blurHash}
            punch={1}
          />
        )}
        {renderThumbnail && (
          <Box
            className={classNames(css.AbsoluteContainer, blurred && css.Blur)}
            alignItems="Center"
            justifyContent="Center"
          >
            {renderThumbnail()}
          </Box>
        )}
        {needsBlob && state.status !== AsyncStatus.Success ? (
          <Box className={css.AbsoluteContainer} alignItems="Center" justifyContent="Center">
            <Spinner variant="Secondary" />
          </Box>
        ) : (
          <Box className={classNames(css.AbsoluteContainer, blurred && css.Blur)}>
            <Video
              ref={videoRef}
              title={body}
              src={src}
              // A GIF shows controls only once the browser has refused to play
              // it, which is the one case where the user has no other way in.
              controls={!gif || playbackRefused}
              autoPlay={autoPlay}
              loop={!!gif}
              muted={!!gif}
              playsInline
              preload="metadata"
              onError={onSrcError}
            />
          </Box>
        )}
        {renderOverlay && !blurred && <Box className={css.AbsoluteHeader}>{renderOverlay()}</Box>}
        {blurred && (
          <Box className={css.AbsoluteContainer} alignItems="Center" justifyContent="Center">
            <TooltipProvider
              tooltip={
                typeof spoilerReason === 'string' && (
                  <Tooltip variant="Secondary">
                    <Text>{spoilerReason}</Text>
                  </Tooltip>
                )
              }
              position="Top"
              align="Center"
            >
              {(triggerRef) => (
                <Chip
                  ref={triggerRef}
                  variant="Secondary"
                  radii="Pill"
                  size="500"
                  outlined
                  onClick={() => setBlurred(false)}
                >
                  <Text size="B300">Spoiler</Text>
                </Chip>
              )}
            </TooltipProvider>
          </Box>
        )}
      </Box>
    );
  },
);
