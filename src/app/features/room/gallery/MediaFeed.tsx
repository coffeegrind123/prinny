import {
  MouseEventHandler,
  PointerEvent as ReactPointerEvent,
  PointerEventHandler,
  ReactEventHandler,
  TouchEvent as ReactTouchEvent,
  WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Avatar,
  Badge,
  Box,
  Chip,
  Icon,
  IconButton,
  Icons,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  PopOut,
  RectCords,
  Spinner,
  Text,
  Tooltip,
  TooltipProvider,
} from 'folds';
import { FocusTrap } from 'focus-trap-react';
import { Room } from 'matrix-js-sdk';
import { MediaItem } from '../../../hooks/useRoomMedia';
import { useMediaSrc } from '../../../hooks/useMediaSrc';
import { useResolvedMediaSrc } from '../../../components/url-preview/GifMedia';
import { useHlsPlayback } from '../../../components/url-preview/useHlsPlayback';
import { useMediaDownload } from '../../../hooks/useMediaDownload';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { useMediaThumbnail } from './useMediaThumbnail';
import { useMediaReaction } from './useMediaReaction';
import { AsyncStatus } from '../../../hooks/useAsyncCallback';
import { BlurhashCanvas } from '../../../components/BlurhashCanvas';
import { UserAvatar } from '../../../components/user-avatar';
import { EmojiBoard } from '../../../components/emoji-board';
import { useZoom } from '../../../hooks/useZoom';
import { getMemberAvatarMxc, getMemberDisplayName } from '../../../utils/room';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../../utils/matrix';
import { bytesToSize, nameInitials } from '../../../utils/common';
import { timeDayMonthYear, timeHourMinute } from '../../../utils/time';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';
import { stopPropagation } from '../../../utils/keyboard';
import { useKeyDown } from '../../../hooks/useKeyDown';
import { ScreenSize, useScreenSizeContext } from '../../../hooks/useScreenSize';
import * as css from './MediaFeed.css';

/** Pages either side of the active one that get real media elements. */
const WINDOW = 1;
/** Distance from the end of the list at which more history is fetched. */
const LOAD_MORE_DISTANCE = 3;

type FeedContentProps = {
  room: Room;
  item: MediaItem;
  active: boolean;
  muted: boolean;
  hour24Clock: boolean;
  /** Emoji packs the reaction menu offers, same set the timeline uses. */
  imagePackRooms: Room[];
  onJump: (item: MediaItem) => void;
  onReply: (item: MediaItem) => void;
  requestClose: () => void;
  /**
   * Told whether a menu of ours is open in a portal outside the feed's focus
   * trap, so a click in that menu is not mistaken for a click outside the feed.
   * Keyed by page, because three pages are mounted at once and one of them
   * unmounting must not clear a menu another one has open.
   */
  onPopOutChange: (key: string, open: boolean) => void;
};

/** Zoom the double-click / Zoom button jumps to, and the wheel/pinch bounds. */
const ZOOM_STEP = 0.25;
const ZOOM_SNAP = 2.5;
const ZOOM_MIN = 1;
const ZOOM_MAX = 8;

/**
 * One attachment, filling the stage, with everything that acts on it.
 *
 * Mounted only for the active page and its immediate neighbours — every hook
 * in here fetches something (the media, its thumbnail, its reactions), so
 * mounting it for a hundred pages would be a hundred downloads.
 */
function MediaFeedContent({
  room,
  item,
  active,
  muted,
  hour24Clock,
  imagePackRooms,
  onJump,
  onReply,
  requestClose,
  onPopOutChange,
}: FeedContentProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const isMobile = useScreenSizeContext() === ScreenSize.Mobile;

  const isEmbed = item.source === 'embed';
  const attachment = useMediaSrc(
    item.mxcUrl ?? '',
    item.mimeType,
    item.encInfo,
    item.filename,
    !isEmbed,
  );
  // Media inside a linked post is a cross-origin URL on the provider's CDN.
  // `<img>` honours `referrerpolicy` and can take it directly; `<video>` cannot
  // — see the note on `useResolvedMediaSrc` — so video is fetched to a blob
  // with the referrer stripped, natively inside the shell and in-page on the
  // web.
  // An HLS playlist is not a file to fetch — hls.js pulls its own segments —
  // so it skips the blob path entirely and is attached to the element below.
  const isHls = isEmbed && !!item.hls;
  const embedSrc = useResolvedMediaSrc(
    isEmbed && !isHls ? (item.httpUrl ?? '') : '',
    isEmbed && !isHls && item.type === 'video',
  );
  const { state, needsBlob, onSrcError } = attachment;
  let src: string | undefined;
  if (isHls) src = item.httpUrl;
  else if (isEmbed) src = embedSrc ?? undefined;
  else src = attachment.src;
  const thumbnail = useMediaThumbnail(item, true);
  const reaction = useMediaReaction(room, item.eventId);
  const download = useMediaDownload(
    item.filename,
    item.mxcUrl ?? '',
    item.mimeType,
    item.encInfo,
    isEmbed ? item.httpUrl : undefined,
  );

  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsError = useHlsPlayback(videoRef, isHls ? item.httpUrl : undefined, isHls);
  const [userPaused, setUserPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [revealed, setRevealed] = useState(!item.spoiler);
  const [expandedCaption, setExpandedCaption] = useState(false);
  const [emojiAnchor, setEmojiAnchor] = useState<RectCords>();

  // Zoom and pan live on the stage itself rather than in a lightbox opened on
  // top of it. The feed is the media viewer now, so a photo has to be
  // inspectable where it already is — opening a second full-screen surface to
  // do the one thing you opened the first one for is a seam, not a feature.
  const { zoom, setZoom } = useZoom(ZOOM_STEP, ZOOM_MIN, ZOOM_MAX);
  const zoomedIn = zoom !== 1;
  const [pan, setPan] = useState({ translateX: 0, translateY: 0 });
  const mediaRef = useRef<HTMLElement | null>(null);
  // Read by the drag handlers, which are installed on the document and would
  // otherwise close over the zoom level they were installed at.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  // Two-finger pinch, and one-finger drag once zoomed. Held in a ref because
  // every move event reads it and re-rendering per touchmove is what makes a
  // pinch feel like it is fighting back.
  const touchRef = useRef<{
    baseDist: number;
    baseZoom: number;
    lastX: number;
    lastY: number;
    fingers: number;
  } | null>(null);
  const [playbackRefused, setPlaybackRefused] = useState(false);
  // A plain image gets its URL immediately and then spends real time fetching
  // the pixels behind it, so `src` alone is not "ready" — without this the
  // blurhash disappears the moment the URL resolves and leaves a blank stage.
  const [imageLoaded, setImageLoaded] = useState(false);
  /**
   * How much the stage is already shrinking the picture to make it fit.
   *
   * A zoom figure means nothing without this. "150%" of a 6000px photo scaled
   * down to fit a laptop screen is still smaller than the file, and a viewer
   * that says 150% while showing you less than half the pixels is lying about
   * the only thing the number is for. Everything the user sees is therefore
   * expressed against the image's own size, and 100% means one image pixel per
   * device pixel.
   */
  const [fitScale, setFitScale] = useState(1);

  const isVideo = item.type === 'video';
  let loading: boolean;
  if (isEmbed) loading = isVideo ? !src : !src || !imageLoaded;
  else if (isVideo) loading = needsBlob && state.status !== AsyncStatus.Success;
  else loading = !src || !imageLoaded;
  const failed = isEmbed ? !!hlsError : state.status === AsyncStatus.Error;
  const failureText = hlsError ?? 'Failed to load this attachment.';

  const senderName =
    getMemberDisplayName(room, item.sender) ?? getMxIdLocalPart(item.sender) ?? item.sender;
  const senderAvatarMxc = getMemberAvatarMxc(room, item.sender);
  const senderAvatarUrl = senderAvatarMxc
    ? (mxcUrlToHttp(mx, senderAvatarMxc, useAuthentication, 96, 96, 'crop') ?? undefined)
    : undefined;

  // A page that scrolls away stops playing and rewinds, so coming back to it
  // starts the clip again rather than resuming a video the user left behind.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    if (active && !userPaused && revealed) {
      video.play().catch(() => setPlaybackRefused(true));
      return;
    }
    video.pause();
    if (!active) {
      video.currentTime = 0;
      setProgress(0);
      setUserPaused(false);
    }
  }, [active, userPaused, revealed, src]);

  // A page the user has left goes back to 1x, so returning to it later shows
  // the whole picture rather than wherever they had dragged it to.
  useEffect(() => {
    if (!active) setZoom(1);
  }, [active, setZoom]);

  // Each page measures its own picture; carrying the previous one's fit ratio
  // over would put a wrong percentage on the next image until it loaded.
  useEffect(() => {
    setFitScale(1);
    setImageLoaded(false);
  }, [src]);

  // Zooming back out re-centres. A picture that fits the stage has nowhere to
  // be panned to, and leaving an old offset applied would show it off-centre.
  useEffect(() => {
    if (!zoomedIn) setPan({ translateX: 0, translateY: 0 });
  }, [zoomedIn]);

  // Drag-to-pan, on the document so the gesture survives the pointer leaving
  // the image — which it does constantly at high zoom.
  const handleStageMouseDown: MouseEventHandler<HTMLElement> = (evt) => {
    if (zoomRef.current === 1) return;
    if (!hitMedia(evt.clientX, evt.clientY)) return;
    evt.preventDefault();
    const onMove = (moveEvt: MouseEvent) => {
      moveEvt.preventDefault();
      setPan((current) => ({
        translateX: current.translateX + moveEvt.movementX / zoomRef.current,
        translateY: current.translateY + moveEvt.movementY / zoomRef.current,
      }));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // Tell the feed whether a portal-rendered menu of ours is open — see
  // `onPopOutChange`.
  useEffect(() => {
    onPopOutChange(item.key, !!emojiAnchor);
  }, [item.key, emojiAnchor, onPopOutChange]);
  useEffect(() => () => onPopOutChange(item.key, false), [item.key, onPopOutChange]);

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || !video.duration || Number.isNaN(video.duration)) return;
    setProgress(video.currentTime / video.duration);
  };

  const seekTo = useCallback((ratio: number) => {
    const video = videoRef.current;
    if (!video || !video.duration || Number.isNaN(video.duration)) return;
    const clamped = Math.max(0, Math.min(1, ratio));
    video.currentTime = clamped * video.duration;
    setProgress(clamped);
  }, []);

  const seekFromPointer = (evt: ReactPointerEvent<HTMLDivElement>) => {
    const rect = evt.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    seekTo((evt.clientX - rect.left) / rect.width);
  };

  const handleSeekDown: PointerEventHandler<HTMLDivElement> = (evt) => {
    evt.currentTarget.setPointerCapture(evt.pointerId);
    seekFromPointer(evt);
  };
  const handleSeekMove: PointerEventHandler<HTMLDivElement> = (evt) => {
    if (!evt.currentTarget.hasPointerCapture(evt.pointerId)) return;
    seekFromPointer(evt);
  };

  /** True when a pointer event landed on the media itself rather than beside it. */
  const hitMedia = (clientX: number, clientY: number): boolean => {
    const rect = mediaRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return false;
    return (
      clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
    );
  };

  /** Zoom value at which one image pixel covers one device pixel. */
  const originalZoom = fitScale > 0 ? 1 / fitScale : 1;
  const atOriginal = Math.abs(zoom - originalZoom) < 0.01;

  const toggleZoom = useCallback(() => {
    setZoom((current) => {
      if (current !== 1) return 1;
      // Zooming in goes to the image's own size when that is a magnification
      // worth making — otherwise to a fixed step, because a picture already
      // displayed larger than its file has nothing to reveal at 1:1.
      const original = fitScale > 0 ? 1 / fitScale : 1;
      return original > 1.05 ? Math.min(ZOOM_MAX, original) : ZOOM_SNAP;
    });
  }, [setZoom, fitScale]);

  const handleImageLoad: ReactEventHandler<HTMLImageElement> = (evt) => {
    setImageLoaded(true);
    const img = evt.currentTarget;
    // `clientWidth` is the laid-out width at zoom 1 — the element is scaled by
    // a transform, which does not change layout.
    if (img.naturalWidth > 0 && img.clientWidth > 0) {
      setFitScale(img.clientWidth / img.naturalWidth);
    }
  };

  // Tapping the stage pauses a video, the way it does in any short-video feed.
  // A tap *beside* the media closes the feed instead: the letterboxing either
  // side of a portrait photo is the backdrop, and clicking a backdrop to
  // dismiss is what every image viewer has taught people to expect.
  const handleStageClick: MouseEventHandler<HTMLButtonElement> = (evt) => {
    if (!revealed) {
      setRevealed(true);
      return;
    }
    if (!hitMedia(evt.clientX, evt.clientY)) {
      // A drag that ends outside the media is a pan overshoot, not a dismissal.
      if (zoomedIn) return;
      requestClose();
      return;
    }
    if (isVideo) {
      setUserPaused((paused) => !paused);
      setPlaybackRefused(false);
      return;
    }
    setExpandedCaption((expanded) => !expanded);
  };

  const handleStageDoubleClick: MouseEventHandler<HTMLButtonElement> = (evt) => {
    if (isVideo || !revealed) return;
    if (!hitMedia(evt.clientX, evt.clientY)) return;
    evt.preventDefault();
    toggleZoom();
  };

  // Ctrl/⌘ + wheel zooms, the way it does in every other picture surface.
  // A bare wheel is left to the scroller, because that is how the feed moves
  // between attachments and stealing it would break the whole gesture.
  const handleStageWheel = (evt: ReactWheelEvent<HTMLElement>) => {
    if (isVideo || !revealed) return;
    if (!evt.ctrlKey && !evt.metaKey) return;
    evt.preventDefault();
    const factor = Math.exp(-evt.deltaY / 300);
    setZoom((current) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current * factor)));
  };

  const handleTouchStart = (evt: ReactTouchEvent<HTMLElement>) => {
    if (isVideo || !revealed) return;
    if (evt.touches.length === 1 && !hitMedia(evt.touches[0].clientX, evt.touches[0].clientY)) {
      return;
    }
    if (evt.touches.length === 2) {
      const [t1, t2] = [evt.touches[0], evt.touches[1]];
      touchRef.current = {
        baseDist: Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY),
        baseZoom: zoom,
        lastX: (t1.clientX + t2.clientX) / 2,
        lastY: (t1.clientY + t2.clientY) / 2,
        fingers: 2,
      };
      return;
    }
    if (evt.touches.length === 1 && zoomedIn) {
      const [t1] = [evt.touches[0]];
      touchRef.current = {
        baseDist: 0,
        baseZoom: zoom,
        lastX: t1.clientX,
        lastY: t1.clientY,
        fingers: 1,
      };
    }
  };

  const handleTouchMove = (evt: ReactTouchEvent<HTMLElement>) => {
    const gesture = touchRef.current;
    if (!gesture) return;

    if (gesture.fingers === 2 && evt.touches.length === 2) {
      const [t1, t2] = [evt.touches[0], evt.touches[1]];
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      if (gesture.baseDist === 0) return;
      // Suppress the browser's own pinch-zoom, which would otherwise scale the
      // whole app around our scaled image.
      evt.preventDefault();
      const next = gesture.baseZoom * (dist / gesture.baseDist);
      setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next)));
      return;
    }

    if (gesture.fingers === 1 && evt.touches.length === 1 && zoomedIn) {
      const [t1] = [evt.touches[0]];
      const dx = t1.clientX - gesture.lastX;
      const dy = t1.clientY - gesture.lastY;
      gesture.lastX = t1.clientX;
      gesture.lastY = t1.clientY;
      // Without this the drag reaches the snap scroller and pages the feed
      // instead of moving the picture.
      evt.preventDefault();
      setPan((current) => ({
        translateX: current.translateX + dx / zoom,
        translateY: current.translateY + dy / zoom,
      }));
    }
  };

  const handleTouchEnd = (evt: ReactTouchEvent<HTMLElement>) => {
    if (evt.touches.length === 0) touchRef.current = null;
  };

  const paused = isVideo && (userPaused || playbackRefused);
  const blurred = !revealed;
  let stageActionLabel = 'Close, or click the image for details';
  if (blurred) stageActionLabel = 'Reveal spoiler';
  else if (isVideo) stageActionLabel = 'Play or pause, or click beside the video to close';

  const dimensions = item.width && item.height ? `${item.width}×${item.height}` : undefined;
  const meta = [
    `${timeDayMonthYear(item.ts)} ${timeHourMinute(item.ts, hour24Clock)}`,
    dimensions,
    typeof item.size === 'number' ? bytesToSize(item.size) : undefined,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      {/* A blurred copy of the still behind the media, so a portrait photo on a
          landscape window is framed rather than floating in flat black. */}
      {(thumbnail.src ?? thumbnail.fallbackSrc) && !blurred && (
        <img
          className={css.FeedBackdrop}
          src={thumbnail.src ?? thumbnail.fallbackSrc}
          alt=""
          aria-hidden
          referrerPolicy={isEmbed ? 'no-referrer' : undefined}
        />
      )}
      {typeof item.blurHash === 'string' && loading && (
        <BlurhashCanvas
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          width={32}
          height={32}
          hash={item.blurHash}
          punch={1}
        />
      )}

      {src && isVideo && (
        <video
          className={css.FeedMedia}
          ref={(node) => {
            videoRef.current = node;
            mediaRef.current = node;
          }}
          // hls.js attaches the stream itself; handing the element an m3u8
          // `src` makes a non-Safari engine fail to decode it before hls.js
          // gets a chance.
          src={isHls ? undefined : src}
          poster={thumbnail.src ?? thumbnail.fallbackSrc}
          title={item.filename}
          style={blurred ? { filter: 'blur(44px)' } : undefined}
          loop
          muted={muted}
          playsInline
          preload="auto"
          onTimeUpdate={handleTimeUpdate}
          onError={onSrcError}
        />
      )}
      {src && !isVideo && (
        <img
          className={css.FeedMedia}
          ref={(node) => {
            mediaRef.current = node;
          }}
          src={src}
          alt={item.filename}
          style={{
            ...(blurred ? { filter: 'blur(44px)' } : undefined),
            transform: `scale(${zoom}) translate(${pan.translateX}px, ${pan.translateY}px)`,
            transformOrigin: 'center center',
            // Past its own resolution, smoothing invents detail that is not in
            // the file. Anyone zoomed in that far is inspecting pixels — pixel
            // art, a screenshot, a crop — and wants to see the actual ones.
            imageRendering: zoom > originalZoom + 0.01 ? 'pixelated' : undefined,
          }}
          draggable={false}
          // `pbs.twimg.com` answers 403 to a cross-origin referrer, and an
          // `<img>` is the one element that honours this attribute — which is
          // why embed stills need no proxy while embed *video* does.
          referrerPolicy={isEmbed ? 'no-referrer' : undefined}
          onLoad={handleImageLoad}
        />
      )}

      {loading && !failed && (
        <Box className={css.FeedCenterBadge}>
          <Spinner variant="Secondary" size="400" />
        </Box>
      )}
      {failed && (
        <Box className={css.FeedCenterBadge}>
          <Box className={css.FeedBarGroup} style={{ pointerEvents: 'auto' }}>
            <Icon size="100" src={Icons.Warning} />
            <Text size="T300">{failureText}</Text>
          </Box>
        </Box>
      )}

      {/* One event surface for the whole stage. Every gesture lands here and
          is routed by where it fell — on the picture, or beside it — rather
          than being split between the media element and an overlay, which is
          what made "click outside to close" ambiguous in the first place. */}
      <button
        type="button"
        className={css.FeedTapTarget}
        style={{
          // Once the picture is bigger than the stage the browser's own
          // pinch-zoom and the feed's snap scrolling would both fire underneath
          // our handlers.
          touchAction: zoomedIn ? 'none' : undefined,
          cursor: zoomedIn ? 'grab' : undefined,
        }}
        onClick={handleStageClick}
        onDoubleClick={handleStageDoubleClick}
        onWheel={handleStageWheel}
        onMouseDown={handleStageMouseDown}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        aria-label={stageActionLabel}
      />

      {blurred && (
        <Box className={css.FeedCenterBadge}>
          <Chip
            style={{ pointerEvents: 'auto' }}
            variant="Secondary"
            radii="Pill"
            size="500"
            outlined
            onClick={() => setRevealed(true)}
          >
            <Text size="B300">{item.spoilerReason || 'Spoiler'}</Text>
          </Chip>
        </Box>
      )}
      {paused && revealed && !loading && (
        <Box className={css.FeedCenterBadge}>
          <Box className={css.FeedCenterBadgeInner}>
            <Icon size="600" src={Icons.Play} filled />
          </Box>
        </Box>
      )}

      <Box className={css.FeedScrimTop} />
      <Box className={css.FeedScrimBottom} />

      <Box className={css.FeedInfo} direction="Column" gap="100">
        <Box alignItems="Center" gap="200">
          <Avatar size="200">
            <UserAvatar
              userId={item.sender}
              src={senderAvatarUrl}
              alt={senderName}
              renderFallback={() => <Text size="H6">{nameInitials(senderName)}</Text>}
            />
          </Avatar>
          <Text size="H5" truncate>
            {senderName}
          </Text>
        </Box>
        {item.caption && (
          <Text className={expandedCaption ? css.FeedCaptionExpanded : css.FeedCaption} size="T300">
            {item.caption}
          </Text>
        )}
        {item.embed ? (
          <Text size="T200" style={{ opacity: 0.8 }} truncate>
            {`${item.embed.provider === 'twitter' ? 'Twitter' : 'Bluesky'}${
              item.embed.authorHandle ? ` · @${item.embed.authorHandle}` : ''
            }`}
          </Text>
        ) : (
          <Text size="T200" style={{ opacity: 0.8 }} truncate>
            {item.filename}
          </Text>
        )}
        <Text size="T200" style={{ opacity: 0.7 }} truncate>
          {meta}
        </Text>
      </Box>

      <Box className={css.FeedRail}>
        <PopOut
          position="Left"
          align="End"
          anchor={emojiAnchor}
          content={
            <EmojiBoard
              imagePackRooms={imagePackRooms}
              returnFocusOnDeactivate={false}
              allowTextCustomEmoji
              onEmojiSelect={(key) => {
                reaction.react(key);
                setEmojiAnchor(undefined);
              }}
              onCustomEmojiSelect={(mxc, shortcode) => {
                reaction.react(mxc, shortcode);
                setEmojiAnchor(undefined);
              }}
              requestClose={() => setEmojiAnchor(undefined)}
            />
          }
        >
          <button
            type="button"
            className={css.FeedRailButton}
            onClick={(evt) =>
              setEmojiAnchor((anchor) =>
                anchor ? undefined : evt.currentTarget.getBoundingClientRect(),
              )
            }
            aria-pressed={reaction.reacted}
            aria-expanded={!!emojiAnchor}
            aria-label="React to this message"
          >
            <Icon size="400" src={Icons.SmilePlus} filled={reaction.reacted} />
            <Text as="span" size="L400">
              {reaction.count > 0 ? reaction.count : 'React'}
            </Text>
          </button>
        </PopOut>
        <button
          type="button"
          className={css.FeedRailButton}
          onClick={() => onReply(item)}
          aria-label="Reply to this message"
        >
          <Icon size="400" src={Icons.ReplyArrow} />
          <Text as="span" size="L400">
            Reply
          </Text>
        </button>
        <button
          type="button"
          className={css.FeedRailButton}
          onClick={download.download}
          disabled={download.downloading || isHls}
          aria-label={`Download ${download.downloadName}`}
        >
          {download.downloading ? (
            <Spinner variant="Secondary" size="300" />
          ) : (
            <Icon size="400" src={Icons.Download} filled={download.hasError} />
          )}
          <Text as="span" size="L400">
            Save
          </Text>
        </button>
        {!isVideo && src && (
          <button
            type="button"
            className={css.FeedRailButton}
            onClick={toggleZoom}
            aria-pressed={zoomedIn}
            aria-label={
              zoomedIn
                ? 'Fit the image to the screen'
                : atOriginal
                  ? 'Zoom into this image'
                  : 'Show this image at its own size'
            }
          >
            <Icon size="400" src={zoomedIn ? Icons.Minus : Icons.Plus} />
            <Text as="span" size="L400">
              {zoomedIn ? `${Math.round(zoom * fitScale * 100)}%` : 'Zoom'}
            </Text>
          </button>
        )}
        <button
          type="button"
          className={css.FeedRailButton}
          onClick={() => onJump(item)}
          aria-label="Go to this message in the conversation"
        >
          <Icon size="400" src={Icons.Message} />
          <Text as="span" size="L400">
            Jump
          </Text>
        </button>
      </Box>

      {isVideo && src && !isMobile && (
        <Box
          className={css.FeedProgress}
          onPointerDown={handleSeekDown}
          onPointerMove={handleSeekMove}
        >
          <Box className={css.FeedProgressTrack}>
            <Box
              className={css.FeedProgressFill}
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </Box>
        </Box>
      )}
      {isVideo && src && isMobile && (
        <Box className={css.FeedProgress} style={{ pointerEvents: 'none' }}>
          <Box className={css.FeedProgressTrack}>
            <Box
              className={css.FeedProgressFill}
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </Box>
        </Box>
      )}
    </>
  );
}

export type MediaFeedProps = {
  room: Room;
  items: MediaItem[];
  /** Emoji packs the reaction menu offers, same set the timeline uses. */
  imagePackRooms: Room[];
  /** The attachment to open on. Falls back to the newest one. */
  initialEventId?: string;
  /**
   * The exact entry to open on, when the caller knows it — a gallery tile does,
   * a tap on a timeline photo does not. One event can contribute several
   * entries (a linked post with four pictures), so the event id alone can only
   * land on the first of them.
   */
  initialItemKey?: string;
  loading: boolean;
  hasMore: boolean;
  loadMore: () => void;
  requestClose: () => void;
  /** Offered as "Browse all" when the feed was opened from the timeline. */
  onOpenGallery?: () => void;
  onJump: (item: MediaItem) => void;
  /** Start a reply to the message this attachment came in. */
  onReply: (item: MediaItem) => void;
};

/**
 * Every image and video in the room as one full-screen, snap-scrolling feed.
 *
 * Vertical rather than the usual left/right lightbox because that is what the
 * gesture is on a phone, and because it makes a room's media browsable at the
 * speed you skim it: one flick per attachment, video playing on arrival,
 * nothing to press first.
 *
 * The list it walks is the room's whole media history — the same scan the
 * gallery grid uses — so opening the feed on a photo from the timeline and
 * flicking up keeps going back through the room, fetching older history as it
 * approaches the end.
 */
export function MediaFeed({
  room,
  items,
  imagePackRooms,
  initialEventId,
  initialItemKey,
  loading,
  hasMore,
  loadMore,
  requestClose,
  onOpenGallery,
  onJump,
  onReply,
}: MediaFeedProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hour24Clock] = useSetting(settingsAtom, 'hour24Clock');
  const [muted, setMuted] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const activeIdRef = useRef<string | undefined>(initialItemKey);
  const scrolledToInitial = useRef(false);
  const rafRef = useRef<number | undefined>(undefined);
  // The reaction menu renders in a portal, i.e. outside this component's DOM
  // and therefore outside the focus trap. Without this, the trap reads the
  // first click inside the emoji board as a click outside the feed and
  // dismisses the whole thing under the user.
  const popOutOpenRef = useRef(new Set<string>());
  const handlePopOutChange = useCallback((key: string, open: boolean) => {
    if (open) popOutOpenRef.current.add(key);
    else popOutOpenRef.current.delete(key);
  }, []);

  const initialIndex = useMemo(() => {
    if (initialItemKey) {
      const exact = items.findIndex((item) => item.key === initialItemKey);
      if (exact >= 0) return exact;
    }
    if (!initialEventId) return 0;
    const index = items.findIndex((item) => item.eventId === initialEventId);
    return index < 0 ? 0 : index;
  }, [items, initialEventId, initialItemKey]);

  const scrollToIndex = useCallback((index: number, smooth: boolean) => {
    const el = scrollRef.current;
    if (!el || el.clientHeight === 0) return false;
    el.scrollTo({ top: index * el.clientHeight, behavior: smooth ? 'smooth' : 'auto' });
    return true;
  }, []);

  // Land on the attachment the feed was opened from. When it was opened from
  // the timeline the scan may still be running, so this keeps trying until the
  // event actually turns up in the list.
  useLayoutEffect(() => {
    if (scrolledToInitial.current) return;
    if (items.length === 0) return;
    if (initialEventId && !items.some((item) => item.eventId === initialEventId)) return;
    if (scrollToIndex(initialIndex, false)) {
      setActiveIndex(initialIndex);
      activeIdRef.current = items[initialIndex]?.key;
      scrolledToInitial.current = true;
    }
  }, [items, initialEventId, initialIndex, scrollToIndex]);

  // Older attachments append, but a newly sent one prepends and shifts every
  // index by one. Re-anchor on the attachment the user is actually looking at
  // rather than letting the page under them change.
  useEffect(() => {
    if (!scrolledToInitial.current) return;
    const el = scrollRef.current;
    const activeId = activeIdRef.current;
    if (!el || !activeId || el.clientHeight === 0) return;
    const index = items.findIndex((item) => item.key === activeId);
    if (index < 0) return;
    const expected = index * el.clientHeight;
    if (Math.abs(el.scrollTop - expected) > 4) {
      el.scrollTop = expected;
      setActiveIndex(index);
    }
  }, [items]);

  const handleScroll = useCallback(() => {
    if (rafRef.current !== undefined) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = undefined;
      const el = scrollRef.current;
      if (!el || el.clientHeight === 0) return;
      const index = Math.max(
        0,
        Math.min(items.length - 1, Math.round(el.scrollTop / el.clientHeight)),
      );
      setActiveIndex(index);
      activeIdRef.current = items[index]?.key;
      // Once the user has moved, the feed is theirs: an attachment the feed was
      // opened on but has not been found yet must not arrive from an older page
      // of history and pull them back to it.
      scrolledToInitial.current = true;
    });
  }, [items]);

  useEffect(
    () => () => {
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  // Fetch more history before the user reaches the end of what we have, so a
  // fast scroll does not run into a wall.
  useEffect(() => {
    if (!hasMore || loading) return;
    if (items.length === 0 || activeIndex >= items.length - LOAD_MORE_DISTANCE) {
      loadMore();
    }
  }, [activeIndex, items.length, hasMore, loading, loadMore]);

  const move = useCallback(
    (delta: number) => {
      const next = Math.max(0, Math.min(items.length - 1, activeIndex + delta));
      if (next === activeIndex) return;
      scrollToIndex(next, true);
    },
    [activeIndex, items.length, scrollToIndex],
  );

  useKeyDown(
    window,
    useCallback(
      (evt: KeyboardEvent) => {
        if (evt.altKey || evt.ctrlKey || evt.metaKey) return;
        const { key } = evt;
        // Space and Enter belong to whatever rail button has focus; stealing
        // Space for "next" would make the buttons unusable from the keyboard.
        const activeTag = document.activeElement?.tagName;
        const onControl = activeTag === 'BUTTON' || activeTag === 'INPUT';
        if (onControl && (key === ' ' || key === 'Enter')) return;
        if (key === 'Escape') {
          evt.preventDefault();
          requestClose();
          return;
        }
        if (key === 'ArrowDown' || key === 'PageDown' || key === 'j' || key === ' ') {
          evt.preventDefault();
          move(1);
          return;
        }
        if (key === 'ArrowUp' || key === 'PageUp' || key === 'k') {
          evt.preventDefault();
          move(-1);
          return;
        }
        if (key === 'm') {
          evt.preventDefault();
          setMuted((value) => !value);
        }
      },
      [move, requestClose],
    ),
  );

  const activeItem = items[activeIndex];

  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            clickOutsideDeactivates: () => popOutOpenRef.current.size === 0,
            onDeactivate: requestClose,
            escapeDeactivates: stopPropagation,
          }}
        >
          <Box
            className={css.Feed}
            direction="Column"
            ref={scrollRef}
            onScroll={handleScroll}
            tabIndex={-1}
          >
            <Box className={css.FeedTopBar} alignItems="Center" gap="200">
              <Box className={css.FeedBarGroup} alignItems="Center" gap="100">
                <IconButton size="300" radii="300" variant="Background" onClick={requestClose}>
                  <Icon size="50" src={Icons.ArrowLeft} />
                </IconButton>
                <Text size="L400">
                  {items.length === 0 ? '0' : `${activeIndex + 1} / ${items.length}`}
                  {hasMore ? '+' : ''}
                </Text>
              </Box>
              <Box grow="Yes" />
              <Box className={css.FeedBarGroup} alignItems="Center" gap="100">
                {loading && <Spinner variant="Secondary" size="100" />}
                {onOpenGallery && (
                  <TooltipProvider
                    position="Bottom"
                    align="End"
                    offset={4}
                    tooltip={
                      <Tooltip>
                        <Text>Browse all media</Text>
                      </Tooltip>
                    }
                  >
                    {(triggerRef) => (
                      <IconButton
                        size="300"
                        radii="300"
                        variant="Background"
                        ref={triggerRef}
                        onClick={onOpenGallery}
                        aria-label="Browse all media"
                      >
                        <Icon size="50" src={Icons.Category} />
                      </IconButton>
                    )}
                  </TooltipProvider>
                )}
                <TooltipProvider
                  position="Bottom"
                  align="End"
                  offset={4}
                  tooltip={
                    <Tooltip>
                      <Text>{muted ? 'Unmute (M)' : 'Mute (M)'}</Text>
                    </Tooltip>
                  }
                >
                  {(triggerRef) => (
                    <IconButton
                      size="300"
                      radii="300"
                      variant="Background"
                      ref={triggerRef}
                      onClick={() => setMuted((value) => !value)}
                      aria-pressed={muted}
                      aria-label={muted ? 'Unmute' : 'Mute'}
                    >
                      <Icon size="50" src={muted ? Icons.VolumeMute : Icons.VolumeHigh} />
                    </IconButton>
                  )}
                </TooltipProvider>
              </Box>
            </Box>

            {items.map((item, index) => (
              <Box key={item.key} className={css.FeedPage} shrink="No">
                {Math.abs(index - activeIndex) <= WINDOW && (
                  <MediaFeedContent
                    room={room}
                    item={item}
                    active={index === activeIndex}
                    muted={muted}
                    hour24Clock={hour24Clock}
                    imagePackRooms={imagePackRooms}
                    onJump={onJump}
                    onReply={onReply}
                    requestClose={requestClose}
                    onPopOutChange={handlePopOutChange}
                  />
                )}
              </Box>
            ))}

            {items.length === 0 && (
              <Box className={css.FeedEnd} shrink="No">
                {loading ? (
                  <Spinner variant="Secondary" size="400" />
                ) : (
                  <Text size="T300">No media in this conversation yet.</Text>
                )}
              </Box>
            )}

            {items.length > 0 && (hasMore || loading) && (
              <Box className={css.FeedEnd} shrink="No">
                {loading ? (
                  <>
                    <Spinner variant="Secondary" size="400" />
                    <Text size="T200">Looking further back…</Text>
                  </>
                ) : (
                  <Chip variant="Secondary" radii="Pill" outlined onClick={loadMore}>
                    <Text size="B300">Load older media</Text>
                  </Chip>
                )}
              </Box>
            )}
            {items.length > 0 && !hasMore && !loading && (
              <Box className={css.FeedEnd} shrink="No">
                <Badge variant="Secondary" fill="Soft" radii="Pill">
                  <Text size="L400">That is everything in this conversation</Text>
                </Badge>
                {activeItem && (
                  <Chip variant="Secondary" radii="Pill" outlined onClick={requestClose}>
                    <Text size="B300">Back to the conversation</Text>
                  </Chip>
                )}
              </Box>
            )}
          </Box>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}
