import { IContent, MatrixClient, MsgType } from 'matrix-js-sdk';
import to from '../../utils/await-to';
import {
  IThumbnailContent,
  MATRIX_BLUR_HASH_PROPERTY_NAME,
  MATRIX_SPOILER_PROPERTY_NAME,
} from '../../../types/matrix/common';
import {
  getImageFileUrl,
  getThumbnail,
  getThumbnailDimensions,
  getVideoFileUrl,
  loadImageElement,
  loadVideoElement,
} from '../../utils/dom';
import { encryptFile, getImageInfo, getThumbnailContent, getVideoInfo } from '../../utils/matrix';
import { animatedImageInfo, blobIsAnimated } from '../../utils/animatedMedia';
import { TUploadItem } from '../../state/room/roomInputDrafts';
import { encodeBlurHash } from '../../utils/blurHash';
import { scaleYDimension } from '../../utils/common';

const generateThumbnailContent = async (
  mx: MatrixClient,
  img: HTMLImageElement | HTMLVideoElement,
  dimensions: [number, number],
  encrypt: boolean,
): Promise<IThumbnailContent> => {
  const thumbnail = await getThumbnail(img, ...dimensions);
  if (!thumbnail) throw new Error('Can not create thumbnail!');
  const encThumbData = encrypt ? await encryptFile(thumbnail) : undefined;
  const thumbnailFile = encThumbData?.file ?? thumbnail;
  if (!thumbnailFile) throw new Error('Can not create thumbnail!');

  const data = await mx.uploadContent(thumbnailFile);
  const thumbMxc = data?.content_uri;
  if (!thumbMxc) throw new Error('Failed when uploading thumbnail!');
  const thumbnailContent = getThumbnailContent({
    thumbnail: thumbnailFile,
    encInfo: encThumbData?.encInfo,
    mxc: thumbMxc,
    width: dimensions[0],
    height: dimensions[1],
  });
  return thumbnailContent;
};

export const getImageMsgContent = async (
  mx: MatrixClient,
  item: TUploadItem,
  mxc: string,
): Promise<IContent> => {
  const { file, originalFile, encInfo, metadata } = item;
  const [imgError, imgEl] = await to(loadImageElement(getImageFileUrl(originalFile)));
  if (imgError) console.warn(imgError);

  const content: IContent = {
    msgtype: MsgType.Image,
    filename: file.name,
    body: file.name,
    [MATRIX_SPOILER_PROPERTY_NAME]: metadata.markedAsSpoiler,
  };
  if (imgEl) {
    const blurHash = encodeBlurHash(imgEl, 512, scaleYDimension(imgEl.width, 512, imgEl.height));

    // MSC4230. Sniffed from `originalFile`, never `file`: on an encrypted
    // upload `file` is the ciphertext, whose bytes are by design
    // indistinguishable from noise and would sniff as "not an image".
    const animated = await blobIsAnimated(originalFile);

    content.info = {
      ...getImageInfo(imgEl, file),
      [MATRIX_BLUR_HASH_PROPERTY_NAME]: blurHash,
      ...animatedImageInfo(animated),
    };
  }
  if (encInfo) {
    content.file = {
      ...encInfo,
      url: mxc,
    };
  } else {
    content.url = mxc;
  }
  return content;
};

export const getVideoMsgContent = async (
  mx: MatrixClient,
  item: TUploadItem,
  mxc: string,
): Promise<IContent> => {
  const { file, originalFile, encInfo, metadata } = item;

  const [videoError, videoEl] = await to(loadVideoElement(getVideoFileUrl(originalFile)));
  if (videoError) console.warn(videoError);

  const content: IContent = {
    msgtype: MsgType.Video,
    filename: file.name,
    body: file.name,
    [MATRIX_SPOILER_PROPERTY_NAME]: metadata.markedAsSpoiler,
  };
  if (videoEl) {
    const [thumbError, thumbContent] = await to(
      generateThumbnailContent(
        mx,
        videoEl,
        getThumbnailDimensions(videoEl.videoWidth, videoEl.videoHeight),
        !!encInfo,
      ),
    );
    if (thumbContent && thumbContent.thumbnail_info) {
      thumbContent.thumbnail_info[MATRIX_BLUR_HASH_PROPERTY_NAME] = encodeBlurHash(
        videoEl,
        512,
        scaleYDimension(videoEl.videoWidth, 512, videoEl.videoHeight),
      );
    }
    if (thumbError) console.warn(thumbError);
    content.info = {
      ...getVideoInfo(videoEl, file),
      ...thumbContent,
    };
  }
  if (encInfo) {
    content.file = {
      ...encInfo,
      url: mxc,
    };
  } else {
    content.url = mxc;
  }
  return content;
};

export const getAudioMsgContent = (
  item: TUploadItem,
  mxc: string,
  durationMs?: number,
): IContent => {
  const { file, encInfo } = item;
  const content: IContent = {
    msgtype: MsgType.Audio,
    filename: file.name,
    body: file.name,
    info: {
      mimetype: file.type,
      size: file.size,
      // Every other client shows a duration for audio attachments. We were
      // sending none at all, so ours rendered as an unknown-length blob
      // everywhere, including in Element.
      ...(durationMs !== undefined ? { duration: Math.round(durationMs) } : undefined),
    },
  };
  if (encInfo) {
    content.file = {
      ...encInfo,
      url: mxc,
    };
  } else {
    content.url = mxc;
  }
  return content;
};

/**
 * A voice message is an `m.audio` with extra keys that tell a client to draw a
 * waveform bubble instead of a file row.
 *
 * The shape is MSC1767 (extensible events) plus MSC3245's rendering hint, and
 * it is what Element, Fluffy and Nheko all look for — the empty
 * `org.matrix.msc3245.voice` object IS the signal; the audio itself is an
 * ordinary attachment. Omit these and the message still plays, but arrives
 * looking like a file called "Voice message.ogg", which is exactly the state we
 * are fixing.
 *
 * Waveform values go out as integers 0..1024 (MSC3246).
 */
export const getVoiceMsgContent = (
  item: TUploadItem,
  mxc: string,
  durationMs: number,
  waveform: number[],
): IContent => {
  const { file, encInfo } = item;
  const name = 'Voice message.ogg';
  const mimetype = file.type || 'audio/ogg';
  const duration = Math.round(durationMs);
  const encodedWaveform = waveform.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 1024));

  const content: IContent = {
    msgtype: MsgType.Audio,
    body: 'Voice message',
    filename: name,
    info: {
      mimetype,
      size: file.size,
      duration,
    },
    'org.matrix.msc1767.text': 'Voice message',
    'org.matrix.msc1767.audio': {
      duration,
      waveform: encodedWaveform,
    },
    'org.matrix.msc3245.voice': {},
  };

  if (encInfo) {
    content.file = {
      ...encInfo,
      url: mxc,
    };
    content['org.matrix.msc1767.file'] = {
      file: {
        ...encInfo,
        url: mxc,
      },
      name,
      mimetype,
      size: file.size,
    };
  } else {
    content.url = mxc;
    content['org.matrix.msc1767.file'] = {
      url: mxc,
      name,
      mimetype,
      size: file.size,
    };
  }

  return content;
};

export const getFileMsgContent = (item: TUploadItem, mxc: string): IContent => {
  const { file, encInfo } = item;
  const content: IContent = {
    msgtype: MsgType.File,
    body: file.name,
    filename: file.name,
    info: {
      mimetype: file.type,
      size: file.size,
    },
  };
  if (encInfo) {
    content.file = {
      ...encInfo,
      url: mxc,
    };
  } else {
    content.url = mxc;
  }
  return content;
};
