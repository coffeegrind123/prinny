import { Direction, IEvent, MatrixClient, MatrixEvent, MsgType, Room } from 'matrix-js-sdk';
import { CryptoBackend } from 'matrix-js-sdk/lib/common-crypto/CryptoBackend';
import to from '../../../utils/await-to';
import {
  decryptFile,
  downloadEncryptedMedia,
  downloadMedia,
  getMxIdLocalPart,
  mxcUrlToHttp,
} from '../../../utils/matrix';
import { getMemberDisplayName } from '../../../utils/room';
import { createZip, ZipEntry } from '../../../utils/zip';
import { safeDownloadFilename } from '../../../utils/mimeTypes';
import { isVoiceMessageContent } from '../../../utils/voice-message';

export type ExportFormat = 'html' | 'json' | 'txt';

export type ExportOptions = {
  format: ExportFormat;
  /** Hard cap on messages fetched. */
  limit: number;
  /** Oldest timestamp (ms) to include; unbounded when absent. */
  since?: number;
  /** Newest timestamp (ms) to include; unbounded when absent. */
  until?: number;
  includeAttachments: boolean;
  /** Attachments larger than this are listed but not bundled. */
  maxAttachmentBytes: number;
  useAuthentication: boolean;
  signal: AbortSignal;
  onProgress: (message: string, fetched: number) => void;
};

export type ExportResult = {
  blob: Blob;
  filename: string;
  /** Attachments skipped for being over the size cap. */
  skippedAttachments: number;
};

const PAGE_SIZE = 100;

// The sdk does not export the response type of createMessagesRequest, so the
// shape we rely on is declared here rather than typing the call `any`.
type MessagesResponse = {
  start?: string;
  end?: string;
  chunk: Partial<IEvent>[];
};

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const isAttachment = (mEvent: MatrixEvent): boolean => {
  const msgtype = mEvent.getContent().msgtype;
  return (
    msgtype === MsgType.Image ||
    msgtype === MsgType.Video ||
    msgtype === MsgType.Audio ||
    msgtype === MsgType.File
  );
};

const describeEvent = (room: Room, mEvent: MatrixEvent): string => {
  const content = mEvent.getContent();
  const body = typeof content.body === 'string' ? content.body : '';

  if (mEvent.isRedacted()) return '[message deleted]';
  if (mEvent.getType() === 'm.room.encrypted') return '[could not decrypt]';
  if (isVoiceMessageContent(content)) return '[voice message]';

  switch (content.msgtype) {
    case MsgType.Image:
      return `[image] ${body}`;
    case MsgType.Video:
      return `[video] ${body}`;
    case MsgType.Audio:
      return `[audio] ${body}`;
    case MsgType.File:
      return `[file] ${body}`;
    case MsgType.Emote:
      return `* ${getMemberDisplayName(room, mEvent.getSender() ?? '') ?? ''} ${body}`;
    default:
      return body;
  }
};

/**
 * Pulls history straight from `/messages` rather than through the room's
 * timeline.
 *
 * Using the timeline API would insert the entire exported range into the
 * in-memory timeline, which on a phone exporting a busy room is how you get
 * killed by the OS rather than getting a file. These events are decrypted and
 * then dropped.
 */
const fetchHistory = async (
  mx: MatrixClient,
  room: Room,
  options: ExportOptions,
): Promise<MatrixEvent[]> => {
  const events: MatrixEvent[] = [];
  let from: string | null = null;
  const crypto = mx.getCrypto();

  while (events.length < options.limit) {
    if (options.signal.aborted) throw new Error('aborted');

    let res: MessagesResponse | undefined;
    try {
      res = (await mx.createMessagesRequest(
        room.roomId,
        from,
        Math.min(PAGE_SIZE, options.limit - events.length),
        Direction.Backward,
      )) as MessagesResponse;
    } catch {
      // Stop at whatever we already have rather than failing the whole export;
      // a partial export the user can see beats an error they cannot act on.
      break;
    }
    if (!res) break;

    const chunk = res.chunk ?? [];
    if (chunk.length === 0) break;

    // Backwards paging: events newer than `until` are passed over until the
    // range starts, and the first page reaching past `since` is the last one.
    const inRange = chunk.filter((raw) => {
      const ts = raw.origin_server_ts ?? 0;
      return (
        (options.until === undefined || ts <= options.until) &&
        (options.since === undefined || ts >= options.since)
      );
    });
    const reachedStart =
      options.since !== undefined &&
      chunk.some((raw) => (raw.origin_server_ts ?? Infinity) < (options.since as number));

    await Promise.all(
      inRange.map(async (raw) => {
        const mEvent = new MatrixEvent(raw);
        // See decryptAllTimelineEvent: a redacted event still reports
        // isEncrypted(), and retrying it only produces a decryption error.
        if (mEvent.shouldAttemptDecryption() && crypto) {
          await to(mEvent.attemptDecryption(crypto as CryptoBackend));
        }
        events.push(mEvent);
      }),
    );

    options.onProgress('Fetching messages', events.length);

    if (reachedStart) break;
    if (!res.end || res.end === from) break;
    from = res.end ?? null;
  }

  // /messages walks backwards; an export reads forwards.
  return events
    .filter((mEvent) => mEvent.getType() === 'm.room.message' || mEvent.isEncrypted())
    .sort((a, b) => a.getTs() - b.getTs())
    .slice(-options.limit);
};

const renderTxt = (room: Room, events: MatrixEvent[]): string => {
  const lines = events.map((mEvent) => {
    const sender = mEvent.getSender() ?? '';
    const name = getMemberDisplayName(room, sender) ?? getMxIdLocalPart(sender) ?? sender;
    return `[${new Date(mEvent.getTs()).toISOString()}] ${name}: ${describeEvent(room, mEvent)}`;
  });
  return `${room.name}\n${'='.repeat(room.name.length)}\n\n${lines.join('\n')}\n`;
};

const renderJson = (room: Room, events: MatrixEvent[]): string =>
  JSON.stringify(
    {
      room_id: room.roomId,
      room_name: room.name,
      exported_at: new Date().toISOString(),
      messages: events.map((mEvent) => mEvent.getEffectiveEvent()),
    },
    null,
    2,
  );

const renderHtml = (
  room: Room,
  events: MatrixEvent[],
  attachmentPaths: Map<string, string>,
): string => {
  const rows = events
    .map((mEvent) => {
      const sender = mEvent.getSender() ?? '';
      const name = getMemberDisplayName(room, sender) ?? getMxIdLocalPart(sender) ?? sender;
      const time = new Date(mEvent.getTs()).toLocaleString();
      const eventId = mEvent.getId() ?? '';
      const path = attachmentPaths.get(eventId);

      let bodyHtml = escapeHtml(describeEvent(room, mEvent));
      if (path) {
        const msgtype = mEvent.getContent().msgtype;
        const safePath = escapeHtml(path);
        if (msgtype === MsgType.Image) {
          bodyHtml = `<a href="${safePath}"><img src="${safePath}" alt="${escapeHtml(
            String(mEvent.getContent().body ?? ''),
          )}" /></a>`;
        } else {
          bodyHtml = `<a href="${safePath}">${bodyHtml}</a>`;
        }
      }

      return `<div class="msg"><div class="meta"><span class="who">${escapeHtml(
        name,
      )}</span><span class="when">${escapeHtml(time)}</span></div><div class="body">${bodyHtml}</div></div>`;
    })
    .join('\n');

  // Self-contained and deliberately plain: an export should open in any browser
  // years from now, with no fonts, scripts or styles fetched from anywhere.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(room.name)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0 auto; max-width: 48rem; padding: 1.5rem; line-height: 1.5; }
  h1 { font-size: 1.4rem; }
  .msg { padding: .4rem 0; border-bottom: 1px solid rgba(127,127,127,.2); }
  .meta { display: flex; gap: .5rem; font-size: .8rem; opacity: .7; }
  .who { font-weight: 600; }
  .body { white-space: pre-wrap; overflow-wrap: anywhere; }
  img { max-width: 100%; height: auto; border-radius: .4rem; margin-top: .3rem; }
</style>
</head>
<body>
<h1>${escapeHtml(room.name)}</h1>
<p>${events.length} messages · exported ${escapeHtml(new Date().toLocaleString())}</p>
${rows}
</body>
</html>
`;
};

const fetchAttachment = async (
  mx: MatrixClient,
  mEvent: MatrixEvent,
  useAuthentication: boolean,
): Promise<Blob | undefined> => {
  const content = mEvent.getContent();
  const mxcUrl = content.file?.url ?? content.url;
  if (typeof mxcUrl !== 'string') return undefined;

  const httpUrl = mxcUrlToHttp(mx, mxcUrl, useAuthentication);
  if (!httpUrl) return undefined;

  const mimeType = content.info?.mimetype ?? 'application/octet-stream';
  const [err, blob] = await to(
    content.file
      ? downloadEncryptedMedia(httpUrl, (buf) => decryptFile(buf, mimeType, content.file))
      : downloadMedia(httpUrl),
  );
  if (err) return undefined;
  return blob;
};

export const exportChat = async (
  mx: MatrixClient,
  room: Room,
  options: ExportOptions,
): Promise<ExportResult> => {
  const events = await fetchHistory(mx, room, options);

  const attachmentPaths = new Map<string, string>();
  const entries: ZipEntry[] = [];
  let skippedAttachments = 0;

  if (options.includeAttachments) {
    const attachments = events.filter(isAttachment);
    for (let i = 0; i < attachments.length; i += 1) {
      if (options.signal.aborted) throw new Error('aborted');
      const mEvent = attachments[i];
      const eventId = mEvent.getId();
      const content = mEvent.getContent();
      const size = typeof content.info?.size === 'number' ? content.info.size : 0;

      if (size > options.maxAttachmentBytes) {
        skippedAttachments += 1;
      } else if (eventId) {
        options.onProgress(
          `Downloading attachments (${i + 1}/${attachments.length})`,
          events.length,
        );
        // Sequential on purpose: a phone downloading fifty attachments at once
        // runs out of memory, and the homeserver rate-limits the burst anyway.

        const blob = await fetchAttachment(mx, mEvent, options.useAuthentication);
        if (blob) {
          const base = safeDownloadFilename(
            typeof content.body === 'string' ? content.body : 'attachment',
          );
          const path = `media/${eventId.replace(/[^a-zA-Z0-9]/g, '')}-${base}`;
          attachmentPaths.set(eventId, path);

          entries.push({
            name: path,
            data: new Uint8Array(await blob.arrayBuffer()),
            modified: new Date(mEvent.getTs()),
          });
        }
      }
    }
  }

  options.onProgress('Writing file', events.length);

  const stamp = new Date().toISOString().slice(0, 10);
  // The room name is chosen by other people; the same guard the download path
  // uses keeps a name like "../../etc" from becoming a path.
  const roomSlug = safeDownloadFilename(room.name || room.roomId).replace(/\s+/g, '-');
  const base = `${roomSlug || 'room'}-${stamp}`;

  let text: string;
  let extension: string;
  if (options.format === 'json') {
    text = renderJson(room, events);
    extension = 'json';
  } else if (options.format === 'txt') {
    text = renderTxt(room, events);
    extension = 'txt';
  } else {
    text = renderHtml(room, events, attachmentPaths);
    extension = 'html';
  }

  if (entries.length === 0) {
    return {
      blob: new Blob([text], {
        type: options.format === 'json' ? 'application/json' : `text/${extension}`,
      }),
      filename: `${base}.${extension}`,
      skippedAttachments,
    };
  }

  entries.unshift({
    name: `chat.${extension}`,
    data: new TextEncoder().encode(text),
    modified: new Date(),
  });

  return {
    blob: createZip(entries),
    filename: `${base}.zip`,
    skippedAttachments,
  };
};
