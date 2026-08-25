import { ReactNode, useCallback } from 'react';
import { useSetAtom } from 'jotai';
import { IContent, MsgType } from 'matrix-js-sdk';
import { HTMLReactParserOptions } from 'html-react-parser';
import { Opts } from 'linkifyjs';
import { Box, Chip, Icon, Icons, Text, config } from 'folds';
import {
  AudioContent,
  DownloadFile,
  FileContent,
  ImageContent,
  MAudio,
  MBadEncrypted,
  MEmote,
  MFile,
  MGallery,
  MImage,
  MLocation,
  MNotice,
  MText,
  MVideo,
  MVoice,
  ReadPdfFile,
  ReadTextFile,
  RenderBody,
  ThumbnailContent,
  UnsupportedContent,
  VideoContent,
  VoiceContent,
} from './message';
import { UrlPreviewCard, UrlPreviewHolder } from './url-preview';
import { Image } from './media';
import { ImageViewer } from './image-viewer';
import { PdfViewer } from './Pdf-viewer';
import { TextViewer } from './text-viewer';
import { testMatrixTo } from '../plugins/matrix-to';
import {
  IAudioContent,
  IGalleryContent,
  IImageContent,
  isGalleryMsgType,
} from '../../types/matrix/common';
import { getVoiceAudioBlock, isVoiceMessageContent } from '../utils/voice-message';
import { effectForMsgType } from '../plugins/effects';
import { isMediaAutoEmbedUrl } from '../utils/mediaAutoEmbed';
import { MediaAutoEmbed } from './message/content';
import { useSetting } from '../state/hooks/settings';
import { settingsAtom } from '../state/settings';
import { mediaFeedRequestAtom } from '../state/roomGallery';

type RenderMessageContentProps = {
  displayName: string;
  msgType: string;
  ts: number;
  edited?: boolean;
  getContent: <T>() => T;
  mediaAutoLoad?: boolean;
  urlPreview?: boolean;
  highlightRegex?: RegExp;
  htmlReactParserOptions: HTMLReactParserOptions;
  linkifyOpts: Opts;
  outlineAttachment?: boolean;
  renderLocationMap?: (position: { latitude: string; longitude: string }) => ReactNode;
  /**
   * Where this message lives. Both are needed to open the media feed on it —
   * without them (search results, pinned previews) attachments keep the plain
   * single-image viewer, which is the right fallback: there is no surrounding
   * feed to swipe through in those places.
   */
  roomId?: string;
  eventId?: string;
};
export function RenderMessageContent({
  displayName,
  msgType,
  ts,
  edited,
  getContent,
  mediaAutoLoad,
  urlPreview,
  highlightRegex,
  htmlReactParserOptions,
  linkifyOpts,
  outlineAttachment,
  renderLocationMap,
  roomId,
  eventId,
}: RenderMessageContentProps) {
  const [autoEmbedHosts] = useSetting(settingsAtom, 'mediaAutoEmbedHosts');
  const [mediaFeedViewer] = useSetting(settingsAtom, 'mediaFeedViewer');
  const setMediaFeedRequest = useSetAtom(mediaFeedRequestAtom);

  const feedAvailable = mediaFeedViewer && !!roomId && !!eventId;
  const openInFeed = useCallback(() => {
    if (!roomId || !eventId) return;
    setMediaFeedRequest({ roomId, eventId });
  }, [roomId, eventId, setMediaFeedRequest]);
  const renderUrlsPreview = (urls: string[]) => {
    const filteredUrls = urls.filter((url) => !testMatrixTo(url));
    if (filteredUrls.length === 0) return undefined;

    // A direct video link on a trusted host is played in place; everything else
    // gets the usual preview card. The trusted list is empty by default, so
    // this partition is a no-op until the user fills it in.
    const mediaUrls = filteredUrls.filter((url) => isMediaAutoEmbedUrl(url, autoEmbedHosts));
    const previewUrls = filteredUrls.filter((url) => !isMediaAutoEmbedUrl(url, autoEmbedHosts));

    return (
      <>
        {mediaUrls.length > 0 && (
          <Box direction="Column" gap="200" style={{ marginTop: config.space.S200 }}>
            {mediaUrls.map((url) => (
              <MediaAutoEmbed key={url} url={url} autoLoad={mediaAutoLoad} />
            ))}
          </Box>
        )}
        {previewUrls.length > 0 && (
          <UrlPreviewHolder>
            {previewUrls.map((url) => (
              <UrlPreviewCard key={url} url={url} ts={ts} roomId={roomId} eventId={eventId} />
            ))}
          </UrlPreviewHolder>
        )}
      </>
    );
  };
  const renderCaption = () => {
    const content: IImageContent = getContent();
    if (content.filename && content.filename !== content.body) {
      return (
        <MText
          style={{ marginTop: config.space.S200 }}
          edited={edited}
          content={content}
          renderBody={(props) => (
            <RenderBody
              {...props}
              highlightRegex={highlightRegex}
              htmlReactParserOptions={htmlReactParserOptions}
              linkifyOpts={linkifyOpts}
            />
          )}
          renderUrlsPreview={urlPreview ? renderUrlsPreview : undefined}
        />
      );
    }
    return null;
  };

  const renderFile = () => (
    <>
      <MFile
        content={getContent()}
        renderFileContent={({ body, mimeType, info, encInfo, url }) => (
          <FileContent
            body={body}
            mimeType={mimeType}
            renderAsPdfFile={() => (
              <ReadPdfFile
                body={body}
                mimeType={mimeType}
                url={url}
                encInfo={encInfo}
                renderViewer={(p) => <PdfViewer {...p} />}
              />
            )}
            renderAsTextFile={() => (
              <ReadTextFile
                body={body}
                mimeType={mimeType}
                url={url}
                encInfo={encInfo}
                renderViewer={(p) => <TextViewer {...p} />}
              />
            )}
          >
            <DownloadFile body={body} mimeType={mimeType} url={url} encInfo={encInfo} info={info} />
          </FileContent>
        )}
      />
      {renderCaption()}
    </>
  );

  if (msgType === MsgType.Text) {
    return (
      <MText
        edited={edited}
        content={getContent()}
        renderBody={(props) => (
          <RenderBody
            {...props}
            highlightRegex={highlightRegex}
            htmlReactParserOptions={htmlReactParserOptions}
            linkifyOpts={linkifyOpts}
          />
        )}
        renderUrlsPreview={urlPreview ? renderUrlsPreview : undefined}
      />
    );
  }

  if (msgType === MsgType.Emote) {
    return (
      <MEmote
        displayName={displayName}
        edited={edited}
        content={getContent()}
        renderBody={(props) => (
          <RenderBody
            {...props}
            highlightRegex={highlightRegex}
            htmlReactParserOptions={htmlReactParserOptions}
            linkifyOpts={linkifyOpts}
          />
        )}
        renderUrlsPreview={urlPreview ? renderUrlsPreview : undefined}
      />
    );
  }

  if (msgType === MsgType.Notice) {
    return (
      <MNotice
        edited={edited}
        content={getContent()}
        renderBody={(props) => (
          <RenderBody
            {...props}
            highlightRegex={highlightRegex}
            htmlReactParserOptions={htmlReactParserOptions}
            linkifyOpts={linkifyOpts}
          />
        )}
        renderUrlsPreview={urlPreview ? renderUrlsPreview : undefined}
      />
    );
  }

  // MSC4274: several attachments in one message. Dispatched before the
  // single-attachment cases so the item renderers below can be reused for each
  // item — a gallery is a container, not a new kind of attachment.
  if (isGalleryMsgType(msgType)) {
    const galleryContent = getContent<IGalleryContent>();
    return (
      <>
        <MGallery
          content={galleryContent}
          renderItem={(itemContent: IContent) => (
            <RenderMessageContent
              displayName={displayName}
              msgType={typeof itemContent.msgtype === 'string' ? itemContent.msgtype : ''}
              ts={ts}
              getContent={(() => itemContent) as typeof getContent}
              mediaAutoLoad={mediaAutoLoad}
              urlPreview={false}
              htmlReactParserOptions={htmlReactParserOptions}
              linkifyOpts={linkifyOpts}
              highlightRegex={highlightRegex}
              outlineAttachment={false}
              renderLocationMap={renderLocationMap}
              roomId={roomId}
              eventId={eventId}
            />
          )}
        />
        {renderCaption()}
      </>
    );
  }

  if (msgType === MsgType.Image) {
    return (
      <>
        <MImage
          content={getContent()}
          renderImageContent={(props) => (
            <ImageContent
              {...props}
              autoPlay={mediaAutoLoad}
              renderImage={(p) => (
                <Image {...p} loading="lazy" onClick={feedAvailable ? openInFeed : p.onClick} />
              )}
              renderViewer={(p) => <ImageViewer {...p} />}
            />
          )}
          outlined={outlineAttachment}
        />
        {renderCaption()}
      </>
    );
  }

  if (msgType === MsgType.Video) {
    return (
      <>
        <MVideo
          content={getContent()}
          renderAsFile={renderFile}
          renderVideoContent={({ body, info, ...props }) => (
            <VideoContent
              body={body}
              info={info}
              {...props}
              renderThumbnail={
                mediaAutoLoad
                  ? () => (
                      <ThumbnailContent
                        info={info}
                        renderImage={(src) => (
                          <Image alt={body} title={body} src={src} loading="lazy" />
                        )}
                      />
                    )
                  : undefined
              }
              renderOverlay={
                feedAvailable
                  ? () => (
                      <Chip
                        variant="Secondary"
                        radii="Pill"
                        size="400"
                        onClick={openInFeed}
                        before={<Icon size="50" src={Icons.Category} />}
                        aria-label="Watch in the media feed"
                      >
                        <Text size="B300">Feed</Text>
                      </Chip>
                    )
                  : undefined
              }
            />
          )}
        />
        {renderCaption()}
      </>
    );
  }

  if (msgType === MsgType.Audio) {
    const audioContent = getContent<IContent>();

    if (isVoiceMessageContent(audioContent)) {
      const { duration, waveform } = getVoiceAudioBlock(audioContent);
      // No caption. `renderCaption` prints `body` whenever it differs from
      // `filename`, and on a voice message those two are both protocol
      // boilerplate — "Voice message" and "Voice message.ogg" (see
      // `getVoiceMsgContent`) — not anything the sender typed. Rendering it put
      // a literal "Voice message" label above every voice note.
      return (
        <MVoice
          content={audioContent as IAudioContent}
          renderAsFile={renderFile}
          renderVoiceContent={(props) => (
            <VoiceContent {...props} duration={duration} waveform={waveform} />
          )}
        />
      );
    }

    return (
      <>
        <MAudio
          content={audioContent as IAudioContent}
          renderAsFile={renderFile}
          renderAudioContent={(props) => <AudioContent {...props} />}
        />
        {renderCaption()}
      </>
    );
  }

  if (msgType === MsgType.File) {
    return renderFile();
  }

  if (msgType === MsgType.Location) {
    return (
      <MLocation
        content={getContent()}
        renderMap={
          // The caller decides whether a map may be drawn at all; when it may
          // not, MLocation keeps its link-only form rather than showing an
          // empty frame.
          renderLocationMap
        }
      />
    );
  }

  if (msgType === 'm.bad.encrypted') {
    return <MBadEncrypted />;
  }

  // Effect messages (confetti and friends) are ordinary text wearing a custom
  // msgtype. The animation is triggered elsewhere; here they must still read as
  // the message they are, rather than as "unsupported content".
  if (effectForMsgType(msgType)) {
    return (
      <MText
        edited={edited}
        content={getContent()}
        renderBody={(props) => (
          <RenderBody
            {...props}
            highlightRegex={highlightRegex}
            htmlReactParserOptions={htmlReactParserOptions}
            linkifyOpts={linkifyOpts}
          />
        )}
        renderUrlsPreview={urlPreview ? renderUrlsPreview : undefined}
      />
    );
  }

  return <UnsupportedContent />;
}
