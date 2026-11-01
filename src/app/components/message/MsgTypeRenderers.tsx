import { CSSProperties, ReactNode } from 'react';
import { Box, Chip, Icon, Icons, Text, toRem } from 'folds';
import { IContent } from 'matrix-js-sdk';
import { DecryptionFailureCode } from 'matrix-js-sdk/lib/crypto-api';
import { isJumboEmoji } from '../../utils/regex';
import { extractPreviewUrls } from '../../utils/messageUrls';
import { trimReplyFromBody } from '../../utils/room';
import { MessageTextBody } from './layout';
import { useMessageTrailing } from './MessageTrailing';
import {
  MessageBadEncryptedContent,
  MessageBrokenContent,
  MessageDeletedContent,
  MessageEditedContent,
  MessageUnsupportedContent,
} from './content';
import {
  IAudioContent,
  IAudioInfo,
  IEncryptedFile,
  IFileContent,
  IFileInfo,
  IImageContent,
  IImageInfo,
  IThumbnailContent,
  IVideoContent,
  IVideoInfo,
  MATRIX_GIF_PROPERTY_NAME,
  MATRIX_SPOILER_PROPERTY_NAME,
  MATRIX_SPOILER_REASON_PROPERTY_NAME,
} from '../../../types/matrix/common';
import {
  FALLBACK_MIMETYPE,
  getBlobSafeMimeType,
  getImageSafeMimeType,
} from '../../utils/mimeTypes';
import { fitWithin, parseGeoUri, scaleYDimension } from '../../utils/common';
import { Attachment, AttachmentBox } from './attachment';
import { AttachmentCaption, AttachmentDownloadCaption } from './AttachmentCaption';

/**
 * Every attachment that is not an image is laid out in this column.
 *
 * It is the width `Attachment` used to impose from its own stylesheet. The
 * cards are gone but their sizing is not — without this a native audio player
 * or a file's buttons would stretch to the full timeline width on a wide
 * window.
 */
const ATTACHMENT_COLUMN: CSSProperties = {
  width: toRem(400),
  maxWidth: '100%',
  minWidth: 0,
};

export function MBadEncrypted({ failureCode }: { failureCode?: DecryptionFailureCode | null }) {
  return (
    <Text>
      <MessageBadEncryptedContent failureCode={failureCode} />
    </Text>
  );
}

type RedactedContentProps = {
  reason?: string;
};
export function RedactedContent({ reason }: RedactedContentProps) {
  return (
    <Text>
      <MessageDeletedContent reason={reason} />
    </Text>
  );
}

export function UnsupportedContent() {
  return (
    <Text>
      <MessageUnsupportedContent />
    </Text>
  );
}

export function BrokenContent() {
  return (
    <Text>
      <MessageBrokenContent />
    </Text>
  );
}

type RenderBodyProps = {
  body: string;
  customBody?: string;
};
type MTextProps = {
  edited?: boolean;
  content: Record<string, unknown>;
  renderBody: (props: RenderBodyProps) => ReactNode;
  renderUrlsPreview?: (urls: string[]) => ReactNode;
  style?: CSSProperties;
};
export function MText({ edited, content, renderBody, renderUrlsPreview, style }: MTextProps) {
  const trailing = useMessageTrailing();
  const { body, formatted_body: customBody } = content;

  if (typeof body !== 'string') return <BrokenContent />;
  const trimmedBody = trimReplyFromBody(body);
  const urls = renderUrlsPreview
    ? extractPreviewUrls(trimmedBody, typeof customBody === 'string' ? customBody : undefined)
    : undefined;

  return (
    <Box direction="Column">
      <MessageTextBody
        preWrap={typeof customBody !== 'string'}
        jumboEmoji={isJumboEmoji(trimmedBody)}
        style={style}
      >
        {renderBody({
          body: trimmedBody,
          customBody: typeof customBody === 'string' ? customBody : undefined,
        })}
        {edited && <MessageEditedContent />}
        {trailing}
      </MessageTextBody>
      {renderUrlsPreview && urls && urls.length > 0 && renderUrlsPreview(urls)}
    </Box>
  );
}

type MEmoteProps = {
  displayName: string;
  edited?: boolean;
  content: Record<string, unknown>;
  renderBody: (props: RenderBodyProps) => ReactNode;
  renderUrlsPreview?: (urls: string[]) => ReactNode;
};
export function MEmote({
  displayName,
  edited,
  content,
  renderBody,
  renderUrlsPreview,
}: MEmoteProps) {
  const trailing = useMessageTrailing();
  const { body, formatted_body: customBody } = content;

  if (typeof body !== 'string') return <BrokenContent />;
  const trimmedBody = trimReplyFromBody(body);
  const urls = renderUrlsPreview
    ? extractPreviewUrls(trimmedBody, typeof customBody === 'string' ? customBody : undefined)
    : undefined;

  return (
    <Box direction="Column">
      <MessageTextBody
        emote
        preWrap={typeof customBody !== 'string'}
        jumboEmoji={isJumboEmoji(trimmedBody)}
      >
        <b>{`${displayName} `}</b>
        {renderBody({
          body: trimmedBody,
          customBody: typeof customBody === 'string' ? customBody : undefined,
        })}
        {edited && <MessageEditedContent />}
        {trailing}
      </MessageTextBody>
      {renderUrlsPreview && urls && urls.length > 0 && renderUrlsPreview(urls)}
    </Box>
  );
}

type MNoticeProps = {
  edited?: boolean;
  content: Record<string, unknown>;
  renderBody: (props: RenderBodyProps) => ReactNode;
  renderUrlsPreview?: (urls: string[]) => ReactNode;
};
export function MNotice({ edited, content, renderBody, renderUrlsPreview }: MNoticeProps) {
  const trailing = useMessageTrailing();
  const { body, formatted_body: customBody } = content;

  if (typeof body !== 'string') return <BrokenContent />;
  const trimmedBody = trimReplyFromBody(body);
  const urls = renderUrlsPreview
    ? extractPreviewUrls(trimmedBody, typeof customBody === 'string' ? customBody : undefined)
    : undefined;

  return (
    <Box direction="Column">
      <MessageTextBody
        notice
        preWrap={typeof customBody !== 'string'}
        jumboEmoji={isJumboEmoji(trimmedBody)}
      >
        {renderBody({
          body: trimmedBody,
          customBody: typeof customBody === 'string' ? customBody : undefined,
        })}
        {edited && <MessageEditedContent />}
        {trailing}
      </MessageTextBody>
      {renderUrlsPreview && urls && urls.length > 0 && renderUrlsPreview(urls)}
    </Box>
  );
}

type RenderImageContentProps = {
  body: string;
  filename?: string;
  info?: IImageInfo & IThumbnailContent;
  mimeType?: string;
  url: string;
  encInfo?: IEncryptedFile;
  markedAsSpoiler?: boolean;
  spoilerReason?: string;
};
type MImageProps = {
  content: IImageContent;
  renderImageContent: (props: RenderImageContentProps) => ReactNode;
  outlined?: boolean;
};
export function MImage({ content, renderImageContent, outlined }: MImageProps) {
  const imgInfo = content?.info;
  const mxcUrl = content.file?.url ?? content.url;
  if (typeof mxcUrl !== 'string') {
    return <BrokenContent />;
  }
  // Size the box to the image's own ratio rather than fixing the width and
  // deriving a height: with `object-fit: cover` any mismatch between the two
  // was resolved by cropping the image, so portrait attachments lost their top
  // and bottom. Both dimensions come from `fitWithin`, and the CSS now uses
  // `contain`, so nothing is cut off.
  const [width, height] = fitWithin(imgInfo?.w, imgInfo?.h, 400, 600);

  return (
    <Attachment outlined={outlined} style={{ width: toRem(width) }}>
      <AttachmentBox
        style={{
          width: toRem(width),
          height: toRem(height < 48 ? 48 : height),
        }}
      >
        {renderImageContent({
          body: content.body || 'Image',
          info: imgInfo,
          mimeType: getImageSafeMimeType(imgInfo?.mimetype),
          url: mxcUrl,
          encInfo: content.file,
          markedAsSpoiler: content[MATRIX_SPOILER_PROPERTY_NAME],
          spoilerReason: content[MATRIX_SPOILER_REASON_PROPERTY_NAME],
        })}
      </AttachmentBox>
    </Attachment>
  );
}

type RenderVideoContentProps = {
  body: string;
  /** The sender's filename, so a save from the element's own menu keeps it. */
  filename: string;
  info: IVideoInfo & IThumbnailContent;
  mimeType: string;
  url: string;
  encInfo?: IEncryptedFile;
  /** The sender marked this as a GIF, so it should loop rather than be played. */
  gif: boolean;
  markedAsSpoiler?: boolean;
  spoilerReason?: string;
};
type MVideoProps = {
  content: IVideoContent;
  renderAsFile: () => ReactNode;
  renderVideoContent: (props: RenderVideoContentProps) => ReactNode;
};
/**
 * A video attachment: the platform video element under its filename.
 *
 * The card this used to sit in is gone, along with the banner across its top —
 * a `SurfaceVariant` slab holding a pill with the file extension in it, the
 * filename, and a download icon button. The element below it already draws its
 * own surface and its own controls, so the banner was a second, worse set of
 * chrome around them. What survives is the filename, at the timeline's own
 * secondary-text weight, and one download that lands the file under that name
 * (see AttachmentDownloadCaption).
 */
export function MVideo({ content, renderAsFile, renderVideoContent }: MVideoProps) {
  const videoInfo = content?.info;
  const mxcUrl = content.file?.url ?? content.url;
  const safeMimeType = getBlobSafeMimeType(videoInfo?.mimetype ?? '');

  if (!videoInfo || !safeMimeType.startsWith('video') || typeof mxcUrl !== 'string') {
    if (mxcUrl) {
      return renderAsFile();
    }
    return <BrokenContent />;
  }

  const height = scaleYDimension(videoInfo.w || 400, 400, videoInfo.h || 400);

  const filename = content.filename ?? content.body ?? 'Video';

  return (
    <Box direction="Column" style={ATTACHMENT_COLUMN}>
      <AttachmentDownloadCaption
        filename={filename}
        url={mxcUrl}
        mimeType={safeMimeType}
        encInfo={content.file}
      />
      <AttachmentBox
        style={{
          height: toRem(height < 48 ? 48 : height),
        }}
      >
        {renderVideoContent({
          filename,
          body: content.body || 'Video',
          // Written by the GIF picker on send. Until now nothing read it back
          // when rendering, so a GIF arrived as an ordinary video: a Watch
          // button, then autoplay-and-loop — the loop being right by accident.
          gif: content[MATRIX_GIF_PROPERTY_NAME] === true,
          info: videoInfo,
          mimeType: safeMimeType,
          url: mxcUrl,
          encInfo: content.file,
          markedAsSpoiler: content[MATRIX_SPOILER_PROPERTY_NAME],
          spoilerReason: content[MATRIX_SPOILER_REASON_PROPERTY_NAME],
        })}
      </AttachmentBox>
    </Box>
  );
}

type RenderAudioContentProps = {
  info: IAudioInfo;
  /** The sender's filename, so a save from the element's own menu keeps it. */
  filename: string;
  mimeType: string;
  url: string;
  encInfo?: IEncryptedFile;
};
type MAudioProps = {
  content: IAudioContent;
  renderAsFile: () => ReactNode;
  renderAudioContent: (props: RenderAudioContentProps) => ReactNode;
};
/**
 * An audio attachment: the platform audio element under its filename.
 *
 * Same treatment as MVideo and, before it, MVoice — see MVideo for why the
 * card and its banner went. A `.wav` used to arrive as a filled slab with the
 * word "WAV" in a pill, the filename, and a download button, stacked on top of
 * a player that already had all the controls anyone needed.
 */
export function MAudio({ content, renderAsFile, renderAudioContent }: MAudioProps) {
  const audioInfo = content?.info;
  const mxcUrl = content.file?.url ?? content.url;
  const safeMimeType = getBlobSafeMimeType(audioInfo?.mimetype ?? '');

  if (!audioInfo || !safeMimeType.startsWith('audio') || typeof mxcUrl !== 'string') {
    if (mxcUrl) {
      return renderAsFile();
    }
    return <BrokenContent />;
  }

  const filename = content.filename ?? content.body ?? 'Audio';
  return (
    <Box direction="Column" style={ATTACHMENT_COLUMN}>
      <AttachmentDownloadCaption
        filename={filename}
        url={mxcUrl}
        mimeType={safeMimeType}
        encInfo={content.file}
      />
      {renderAudioContent({
        info: audioInfo,
        filename,
        mimeType: safeMimeType,
        url: mxcUrl,
        encInfo: content.file,
      })}
    </Box>
  );
}

type MVoiceProps = {
  content: IAudioContent;
  renderAsFile: () => ReactNode;
  renderVoiceContent: (props: RenderAudioContentProps) => ReactNode;
};
/**
 * A voice message: the platform audio element, and nothing else.
 *
 * No attachment card, no header, no separate download button. Every one of
 * those was chrome wrapped around a control that already provides the same
 * affordance — the native player carries its own surface, and its overflow menu
 * carries "Download" — so the card only added a grey slab and a second button
 * that did what the first one already did. The filename is worth even less: it
 * is the synthetic "Voice message.ogg" every client stamps on a voice note, not
 * anything the sender chose.
 */
export function MVoice({ content, renderAsFile, renderVoiceContent }: MVoiceProps) {
  const audioInfo = content?.info;
  const mxcUrl = content.file?.url ?? content.url;
  const safeMimeType = getBlobSafeMimeType(audioInfo?.mimetype ?? '');

  if (!safeMimeType.startsWith('audio') || typeof mxcUrl !== 'string') {
    if (mxcUrl) return renderAsFile();
    return <BrokenContent />;
  }

  return (
    // The card is gone but its sizing is not: `Attachment` pinned every
    // attachment to 400px, and dropping the wrapper without replacing that
    // would let the player stretch to the full timeline width on a wide window.
    <Box direction="Column" style={ATTACHMENT_COLUMN}>
      {renderVoiceContent({
        info: audioInfo ?? {},
        filename: content.filename ?? content.body ?? 'Voice message',
        mimeType: safeMimeType,
        url: mxcUrl,
        encInfo: content.file,
      })}
    </Box>
  );
}

type RenderFileContentProps = {
  body: string;
  info: IFileInfo & IThumbnailContent;
  mimeType: string;
  url: string;
  encInfo?: IEncryptedFile;
};
type MFileProps = {
  content: IFileContent;
  renderFileContent: (props: RenderFileContentProps) => ReactNode;
};
/**
 * A file attachment: its name, then whatever can be done with it.
 *
 * There is no player to hand this one over to, so it keeps its buttons — but
 * not the filled card they sat in, nor the extension pill, both of which were
 * the same furniture the media types have now shed. The caption here is inert:
 * `renderFileContent` already supplies an explicit "Download (2.4 MB)", and
 * making the name a second download would restore the duplication this set out
 * to remove.
 */
export function MFile({ content, renderFileContent }: MFileProps) {
  const fileInfo = content?.info;
  const mxcUrl = content.file?.url ?? content.url;

  if (typeof mxcUrl !== 'string') {
    return <BrokenContent />;
  }

  return (
    <Box direction="Column" style={ATTACHMENT_COLUMN}>
      <AttachmentCaption filename={content.filename ?? content.body ?? 'Unnamed File'} />
      {renderFileContent({
        body: content.filename ?? content.body ?? 'File',
        info: fileInfo ?? {},
        mimeType: fileInfo?.mimetype ?? FALLBACK_MIMETYPE,
        url: mxcUrl,
        encInfo: content.file,
      })}
    </Box>
  );
}

type MLocationProps = {
  content: IContent;
  /** Drawn above the link when the viewer has opted into maps. */
  renderMap?: (position: { latitude: string; longitude: string }) => ReactNode;
};
export function MLocation({ content, renderMap }: MLocationProps) {
  const geoUri = content.geo_uri;
  if (typeof geoUri !== 'string') return <BrokenContent />;
  const location = parseGeoUri(geoUri);
  if (!location) return <BrokenContent />;

  // The description the sender gave, when there is one, beats showing them the
  // raw `geo:` URI they never typed.
  const label = typeof content.body === 'string' && content.body ? content.body : geoUri;

  return (
    <Box direction="Column" alignItems="Start" gap="100">
      {renderMap?.(location)}
      <Text size="T400">{label}</Text>
      <Chip
        as="a"
        size="400"
        href={`https://www.openstreetmap.org/?mlat=${location.latitude}&mlon=${location.longitude}#map=16/${location.latitude}/${location.longitude}`}
        target="_blank"
        rel="noreferrer noopener"
        variant="Primary"
        radii="Pill"
        before={<Icon src={Icons.External} size="50" />}
      >
        <Text size="B300">Open Location</Text>
      </Chip>
    </Box>
  );
}

type MStickerProps = {
  content: IImageContent;
  renderImageContent: (props: RenderImageContentProps) => ReactNode;
};
export function MSticker({ content, renderImageContent }: MStickerProps) {
  const imgInfo = content?.info;
  const mxcUrl = content.file?.url ?? content.url;
  if (typeof mxcUrl !== 'string') {
    return <MessageBrokenContent />;
  }
  const height = scaleYDimension(imgInfo?.w || 152, 152, imgInfo?.h || 152);

  return (
    <AttachmentBox
      style={{
        height: toRem(height < 48 ? 48 : height),
        width: toRem(152),
      }}
    >
      {renderImageContent({
        body: content.body || 'Sticker',
        info: imgInfo,
        mimeType: getImageSafeMimeType(imgInfo?.mimetype),
        url: mxcUrl,
        encInfo: content.file,
      })}
    </AttachmentBox>
  );
}
