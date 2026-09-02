// Builds a clean, parseable plain-text transcript from timeline
// events for copy/paste. Format: one block per message,
//   [HH:mm] <sender> body (body lines indented to align after the prefix)
// with reply context quoted above as `> <sender> body` lines.
import { EventTimelineSet, MatrixEvent, Room } from 'matrix-js-sdk';
import { MessageEvent } from '../../types/matrix/room';
import { getMxIdLocalPart } from './matrix';
import { getEditedEvent, getMemberDisplayName, trimReplyFromBody } from './room';
import { timeHourMinute } from './time';

export const formatCopyTimestamp = (ts: number, hour24Clock: boolean): string =>
  timeHourMinute(ts, hour24Clock);

const indentBody = (body: string, indent: string): string =>
  body
    .split('\n')
    .map((line, index) => (index === 0 ? line : `${indent}${line}`))
    .join('\n');

export type TranscriptEventBody = {
  /** emote prefix like "* " when the body is an action */
  prefix: string;
  body: string;
};

/**
 * Produces the plain-text body of an event for transcripts. Returns undefined
 * for events that are not user messages (state events etc), so callers can
 * skip them.
 */
export const getTranscriptEventBody = (
  mEvent: MatrixEvent,
  timelineSet?: EventTimelineSet,
): TranscriptEventBody | undefined => {
  if (mEvent.isRedacted()) {
    return { prefix: '', body: '[redacted]' };
  }

  const type = mEvent.getType();
  if (type === MessageEvent.RoomMessageEncrypted && mEvent.isDecryptionFailure()) {
    return { prefix: '', body: '[unable to decrypt message]' };
  }

  // Decrypted events report as m.room.message.
  if (type !== MessageEvent.RoomMessage && type !== MessageEvent.Sticker) return undefined;

  let content = mEvent.getContent();
  const eventId = mEvent.getId();
  if (timelineSet && eventId) {
    const newContent = getEditedEvent(eventId, mEvent, timelineSet)?.getContent()['m.new_content'];
    if (newContent) content = newContent;
  }

  if (type === MessageEvent.Sticker) {
    const body = typeof content.body === 'string' ? content.body : 'sticker';
    return { prefix: '', body: `[sticker: ${body}]` };
  }

  const rawBody = typeof content.body === 'string' ? content.body : '';
  const body = trimReplyFromBody(rawBody);

  switch (content.msgtype) {
    case 'm.image':
      return { prefix: '', body: `[image: ${body || 'image'}]` };
    case 'm.video':
      return { prefix: '', body: `[video: ${body || 'video'}]` };
    case 'm.audio':
      return { prefix: '', body: `[audio: ${body || 'audio'}]` };
    case 'm.file':
      return { prefix: '', body: `[file: ${body || 'file'}]` };
    case 'm.location':
      return { prefix: '', body: `[location: ${body || 'location'}]` };
    case 'm.emote':
      return { prefix: '* ', body };
    default:
      return { prefix: '', body };
  }
};

const getReplyContextLine = (
  room: Room,
  mEvent: MatrixEvent,
  timelineSet?: EventTimelineSet,
): string | undefined => {
  const { replyEventId } = mEvent;
  if (!replyEventId) return undefined;

  const replyEvent = timelineSet?.findEventById(replyEventId) ?? room.findEventById(replyEventId);
  if (!replyEvent) return '> [reply to unavailable message]';

  const replySenderId = replyEvent.getSender() ?? '';
  const replySender =
    getMemberDisplayName(room, replySenderId) ?? getMxIdLocalPart(replySenderId) ?? replySenderId;
  const parsed = getTranscriptEventBody(replyEvent, timelineSet);
  if (!parsed || parsed.body.length === 0) return undefined;

  const body = parsed.body.replace(/\n/g, ' ');
  return `> <${replySender}> ${body}`;
};

/**
 * Renders one timeline event as a transcript block. Returns undefined for
 * events that are not messages.
 */
export const eventToTranscriptLine = (
  room: Room,
  mEvent: MatrixEvent,
  timelineSet?: EventTimelineSet,
  hour24Clock = true,
): string | undefined => {
  const parsed = getTranscriptEventBody(mEvent, timelineSet);
  if (!parsed) return undefined;

  const senderId = mEvent.getSender() ?? '';
  const sender = getMemberDisplayName(room, senderId) ?? getMxIdLocalPart(senderId) ?? senderId;
  const time = formatCopyTimestamp(mEvent.getTs(), hour24Clock);

  const prefix = `[${time}] <${sender}> ${parsed.prefix}`;
  const indent = ' '.repeat(prefix.length);

  const lines: string[] = [];
  const replyLine = getReplyContextLine(room, mEvent, timelineSet);
  if (replyLine) lines.push(replyLine);
  lines.push(`${prefix}${indentBody(parsed.body, indent)}`);
  return lines.join('\n');
};
