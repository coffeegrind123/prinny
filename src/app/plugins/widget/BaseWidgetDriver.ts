import {
  type Capability,
  type ISendDelayedEventDetails,
  type ISendEventDetails,
  type IReadEventRelationsResult,
  type IRoomEvent,
  WidgetDriver,
  type IWidgetApiErrorResponseDataDetails,
  type ISearchUserDirectoryResult,
  type IGetMediaConfigResult,
  OpenIDRequestState,
  SimpleObservable,
  IOpenIDUpdate,
} from 'matrix-widget-api';
import {
  EventType,
  type IContent,
  MatrixError,
  type MatrixEvent,
  Direction,
  type SendDelayedEventResponse,
  type StateEvents,
  type TimelineEvents,
  MatrixClient,
} from 'matrix-js-sdk';
import { downloadMedia, mxcUrlToHttp } from '../../utils/matrix';

/**
 * The widget-API transport shared by every widget we embed.
 *
 * This is the plumbing only — sending and reading events, uploads, downloads,
 * the user directory. What a given widget is ALLOWED to do is deliberately not
 * decided here: subclasses implement `validateCapabilities`, because the answer
 * is completely different for the Element Call bundle (fixed allowlist, trusted
 * first-party code) and for a third-party widget somebody added to a room (only
 * what the user has explicitly consented to).
 *
 * SECURITY: how much this class actually constrains a widget depends on where
 * that widget is served from. For a CROSS-origin widget the iframe sandbox is a
 * real boundary and this driver is the only way in, so the capability checks
 * bind. For a SAME-origin widget they are advisory only — see the warnings at
 * CallEmbed.getIframe and plugins/widget/widgetUrl.ts.
 */
export abstract class BaseWidgetDriver extends WidgetDriver {
  protected readonly mx: MatrixClient;

  protected readonly inRoomId: string;

  public constructor(mx: MatrixClient, inRoomId: string) {
    super();
    this.mx = mx;
    this.inRoomId = inRoomId;
  }

  public abstract validateCapabilities(requested: Set<Capability>): Promise<Set<Capability>>;

  public async sendEvent(
    eventType: string,
    content: IContent,
    stateKey: string | null = null,
    targetRoomId: string | null = null,
  ): Promise<ISendEventDetails> {
    const roomId = targetRoomId || this.inRoomId;

    let r: { event_id: string } | null;
    if (typeof stateKey === 'string') {
      r = await this.mx.sendStateEvent(
        roomId,
        eventType as keyof StateEvents,
        content as StateEvents[keyof StateEvents],
        stateKey,
      );
    } else if (eventType === EventType.RoomRedaction) {
      // special case: extract the `redacts` property and call redact
      r = await this.mx.redactEvent(roomId, content.redacts);
    } else {
      r = await this.mx.sendEvent(
        roomId,
        eventType as keyof TimelineEvents,
        content as TimelineEvents[keyof TimelineEvents],
      );
    }

    return { roomId, eventId: r.event_id };
  }

  public async sendDelayedEvent(
    delay: number,
    eventType: string,
    content: IContent,
    stateKey: string | null = null,
    targetRoomId: string | null = null,
  ): Promise<ISendDelayedEventDetails> {
    const roomId = targetRoomId || this.inRoomId;

    // matrix-widget-api 1.18 dropped `parentDelayId` from this signature and
    // made `delay` non-nullable. It is an @experimental MSC4140 API, which is
    // how a parameter removal landed in a minor release. Chaining a delayed
    // event onto a parent (`parent_delay_id`) is no longer expressible through
    // the widget API, so the request options are now just the delay.
    const delayOpts = { delay };

    let r: SendDelayedEventResponse | null;
    if (stateKey !== null) {
      // state event
      r = await this.mx._unstable_sendDelayedStateEvent(
        roomId,
        delayOpts,
        eventType as keyof StateEvents,
        content as StateEvents[keyof StateEvents],
        stateKey,
      );
    } else {
      // message event
      r = await this.mx._unstable_sendDelayedEvent(
        roomId,
        delayOpts,
        null,
        eventType as keyof TimelineEvents,
        content as TimelineEvents[keyof TimelineEvents],
      );
    }

    return {
      roomId,
      delayId: r.delay_id,
    };
  }

  public async cancelScheduledDelayedEvent(delayId: string): Promise<void> {
    await this.mx._unstable_cancelScheduledDelayedEvent(delayId);
  }

  public async restartScheduledDelayedEvent(delayId: string): Promise<void> {
    await this.mx._unstable_restartScheduledDelayedEvent(delayId);
  }

  public async sendScheduledDelayedEvent(delayId: string): Promise<void> {
    await this.mx._unstable_sendScheduledDelayedEvent(delayId);
  }

  public async sendToDevice(
    eventType: string,
    encrypted: boolean,
    contentMap: { [userId: string]: { [deviceId: string]: object } },
  ): Promise<void> {
    if (encrypted) {
      const crypto = this.mx.getCrypto();
      if (!crypto) throw new Error('E2EE not enabled');

      // attempt to re-batch these up into a single request
      const invertedContentMap: { [content: string]: { userId: string; deviceId: string }[] } = {};

      for (const userId of Object.keys(contentMap)) {
        const userContentMap = contentMap[userId];

        for (const deviceId of Object.keys(userContentMap)) {
          const content = userContentMap[deviceId];
          const stringifiedContent = JSON.stringify(content);
          invertedContentMap[stringifiedContent] = invertedContentMap[stringifiedContent] || [];
          invertedContentMap[stringifiedContent].push({ userId, deviceId });
        }
      }

      await Promise.all(
        Object.entries(invertedContentMap).map(async ([stringifiedContent, recipients]) => {
          const batch = await crypto.encryptToDeviceMessages(
            eventType,
            recipients,
            JSON.parse(stringifiedContent),
          );

          await this.mx.queueToDevice(batch);
        }),
      );
    } else {
      await this.mx.queueToDevice({
        eventType,
        batch: Object.entries(contentMap).flatMap(([userId, userContentMap]) =>
          Object.entries(userContentMap).map(([deviceId, content]) => ({
            userId,
            deviceId,
            payload: content,
          })),
        ),
      });
    }
  }

  public async readRoomTimeline(
    roomId: string,
    eventType: string,
    msgtype: string | undefined,
    stateKey: string | undefined,
    limit: number,
    since: string | undefined,
  ): Promise<IRoomEvent[]> {
    const safeLimit =
      limit > 0 ? Math.min(limit, Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER; // relatively arbitrary

    const room = this.mx.getRoom(roomId);
    if (room === null) return [];
    const results: MatrixEvent[] = [];
    const events = room.getLiveTimeline().getEvents();

    for (let i = events.length - 1; i >= 0; i -= 1) {
      const ev = events[i];
      if (results.length >= safeLimit) break;
      if (since !== undefined && ev.getId() === since) break;

      if (
        ev.getType() === eventType &&
        !ev.isState() &&
        (eventType !== EventType.RoomMessage || !msgtype || msgtype === ev.getContent().msgtype) &&
        (ev.getStateKey() === undefined || stateKey === undefined || ev.getStateKey() === stateKey)
      ) {
        results.push(ev);
      }
    }

    return results.map((e) => e.getEffectiveEvent() as IRoomEvent);
  }

  public async askOpenID(observer: SimpleObservable<IOpenIDUpdate>): Promise<void> {
    return observer.update({
      state: OpenIDRequestState.Allowed,
      token: await this.mx.getOpenIdToken(),
    });
  }

  public async readRoomState(
    roomId: string,
    eventType: string,
    stateKey: string | undefined,
  ): Promise<IRoomEvent[]> {
    const room = this.mx.getRoom(roomId);
    if (room === null) return [];
    const state = room.getLiveTimeline().getState(Direction.Forward);
    if (state === undefined) return [];

    if (stateKey === undefined)
      return state.getStateEvents(eventType).map((e) => e.getEffectiveEvent() as IRoomEvent);
    const event = state.getStateEvents(eventType, stateKey);
    return event === null ? [] : [event.getEffectiveEvent() as IRoomEvent];
  }

  public async readEventRelations(
    eventId: string,
    roomId?: string,
    relationType?: string,
    eventType?: string,
    from?: string,
    to?: string,
    limit?: number,
    direction?: 'f' | 'b',
  ): Promise<IReadEventRelationsResult> {
    const dir = direction as Direction;
    const targetRoomId = roomId ?? this.inRoomId ?? undefined;

    if (typeof targetRoomId !== 'string') {
      throw new Error('Error while reading the current room');
    }

    const { events, nextBatch, prevBatch } = await this.mx.relations(
      targetRoomId,
      eventId,
      relationType ?? null,
      eventType ?? null,
      { from, to, limit, dir },
    );

    return {
      chunk: events.map((e) => e.getEffectiveEvent() as IRoomEvent),
      nextBatch: nextBatch ?? undefined,
      prevBatch: prevBatch ?? undefined,
    };
  }

  public async searchUserDirectory(
    searchTerm: string,
    limit?: number,
  ): Promise<ISearchUserDirectoryResult> {
    const { limited, results } = await this.mx.searchUserDirectory({ term: searchTerm, limit });

    return {
      limited,
      results: results.map((r) => ({
        userId: r.user_id,
        displayName: r.display_name,
        avatarUrl: r.avatar_url,
      })),
    };
  }

  public async getMediaConfig(): Promise<IGetMediaConfigResult> {
    return this.mx.getMediaConfig();
  }

  public async uploadFile(file: XMLHttpRequestBodyInit): Promise<{ contentUri: string }> {
    const uploadResult = await this.mx.uploadContent(file);

    return { contentUri: uploadResult.content_uri };
  }

  public async downloadFile(contentUri: string): Promise<{ file: XMLHttpRequestBodyInit }> {
    const httpUrl = mxcUrlToHttp(this.mx, contentUri, true);
    if (!httpUrl) {
      throw new Error('Call widget failed to download file! No http url!');
    }
    const blob = await downloadMedia(httpUrl);
    return { file: blob };
  }

  public getKnownRooms(): string[] {
    return this.mx.getVisibleRooms().map((r) => r.roomId);
  }

  public processError(error: unknown): IWidgetApiErrorResponseDataDetails | undefined {
    return error instanceof MatrixError
      ? { matrix_api_error: error.asWidgetApiErrorData() }
      : undefined;
  }
}
