import { useAtomValue } from 'jotai';
import { mDirectAtom } from '../../state/mDirectList';
import { roomToParentsAtom } from '../../state/room/roomToParents';
import { ReactNode, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { MatrixEventEvent, RoomEvent, RoomEventHandlerMap } from 'matrix-js-sdk';
import { roomToUnreadAtom, unreadEqual, unreadInfoToUnread } from '../../state/room/roomToUnread';
import LogoSVG from '../../../../public/res/svg/prinny.svg';
import LogoUnreadSVG from '../../../../public/res/svg/prinny-unread.svg';
import LogoHighlightSVG from '../../../../public/res/svg/prinny-highlight.svg';
import NotificationSound from '../../../../public/sound/notification.ogg';
import InviteSound from '../../../../public/sound/invite.ogg';
import { setFavicon } from '../../utils/dom';
import { renderFaviconWithBadge } from '../../utils/favicon-badge';
import {
  isNotificationPermissionGrantedSync,
  sendDesktopNotification,
  onNotificationAction,
  isTauri,
  primeDesktopNotificationPermission,
  ensureAndroidNotificationPermission,
} from '../../utils/desktop-notifications';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { allInvitesAtom } from '../../state/room-list/inviteList';
import { usePreviousValue } from '../../hooks/usePreviousValue';
import { useSystemTray } from '../../hooks/useSystemTray';
import { useContentProtection } from '../../hooks/useContentProtection';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { getInboxInvitesPath } from '../pathUtils';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { useWindowFocusedRef } from '../../hooks/useWindowFocused';
import {
  getMemberDisplayName,
  getNotificationType,
  getUnreadInfo,
  isNotificationEvent,
} from '../../utils/room';
import { NotificationType, UnreadInfo } from '../../../types/matrix/room';
import { useSpaceAutoJoinGlobal } from '../../hooks/useSpaceAutoJoinGlobal';
import { RichPresencePublisher } from '../../hooks/useRichPresencePublisher';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../utils/matrix';
import { useSelectedRoom } from '../../hooks/router/useSelectedRoom';
import { useInboxNotificationsSelected } from '../../hooks/router/useInbox';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useNotificationAvatarCache } from '../../hooks/useNotificationAvatarCache';
import { getCurrentWindow, UserAttentionType } from '@tauri-apps/api/window';
import { GlobalKeybinds } from '../../components/global-keybinds/GlobalKeybinds';
import { MatrixLinkHandler } from '../../components/MatrixLinkHandler';
import { BotStartLinkHandler } from '../../components/BotStartLinkHandler';
import { ShareTargetHandler } from '../../features/share/ShareTargetHandler';
import { isVoiceMessageContent } from '../../utils/voice-message';

function SystemEmojiFeature() {
  const [twitterEmoji] = useSetting(settingsAtom, 'twitterEmoji');

  if (twitterEmoji) {
    document.documentElement.style.setProperty('--font-emoji', 'Twemoji');
  } else {
    document.documentElement.style.setProperty('--font-emoji', 'Twemoji_DISABLED');
  }

  return null;
}

function PageZoomFeature() {
  const [pageZoom] = useSetting(settingsAtom, 'pageZoom');

  if (pageZoom === 100) {
    document.documentElement.style.removeProperty('font-size');
  } else {
    document.documentElement.style.setProperty('font-size', `calc(1em * ${pageZoom / 100})`);
  }

  return null;
}

function SystemTray() {
  useSystemTray();
  useContentProtection();
  return null;
}

function FaviconUpdater() {
  const roomToUnread = useAtomValue(roomToUnreadAtom);

  useEffect(() => {
    let total = 0;
    let highlight = false;
    roomToUnread.forEach((unread) => {
      total += unread.total;
      if (unread.highlight > 0) {
        highlight = true;
      }
    });

    if (total === 0) {
      setFavicon(LogoSVG);
      return undefined;
    }

    // The dotted images stay as the immediate answer and as the fallback: the
    // badge has to decode an image and rasterise a canvas, and until that lands
    // the tab should already show that something is unread. Same reason the
    // count is summed the way `TaskbarBadgeUpdater` sums it — one unread meaning
    // for the taskbar and the tab, not two.
    setFavicon(highlight ? LogoHighlightSVG : LogoUnreadSVG);

    // Guards against an out-of-order finish: unread state can change several
    // times while one render is in flight, and the last one to resolve is not
    // necessarily the current one.
    let current = true;
    renderFaviconWithBadge(LogoSVG, total, highlight).then((badged) => {
      if (current && badged) setFavicon(badged);
    });
    return () => {
      current = false;
    };
  }, [roomToUnread]);

  return null;
}

function TaskbarBadgeUpdater() {
  const roomToUnread = useAtomValue(roomToUnreadAtom);

  useEffect(() => {
    if (!isTauri()) return;

    let totalUnread = 0;
    roomToUnread.forEach((unread) => {
      totalUnread += unread.total;
    });

    import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke('set_badge_count', { count: totalUnread }).catch(() => {});
    });
  }, [roomToUnread]);

  return null;
}

function InviteNotifications() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const invites = useAtomValue(allInvitesAtom);
  const perviousInviteLen = usePreviousValue(invites.length, 0);
  const mx = useMatrixClient();

  // Mounted HERE rather than in ClientRoot, and it matters which: this reads
  // `useMediaAuthentication`, which reads `useSpecVersions`, and that context is
  // provided by a component ClientRoot RENDERS — so a hook called in ClientRoot's
  // own body runs outside it and throws "Server versions are not provided!",
  // taking the whole app to an error screen on startup. Everything in this file
  // is already inside both providers.
  useNotificationAvatarCache(mx);

  const navigate = useNavigate();
  const [showNotifications] = useSetting(settingsAtom, 'showNotifications');
  const [notificationSound] = useSetting(settingsAtom, 'isNotificationSounds');

  const notify = useCallback(
    (count: number) => {
      if (isTauri()) {
        sendDesktopNotification('Invitation', {
          icon: LogoSVG,
          body: `You have ${count} new invitation request.`,
        });
      }

      // Flash the taskbar button until the window is looked at.
      //
      // `Critical`, not `Informational`. They are not degrees of loudness:
      // tao maps Informational to `(FLASHW_TRAY, 4)` — exactly four blinks and
      // then silence, which is over before you glance at the taskbar and is
      // indistinguishable from nothing if you were not already looking.
      // Critical is `FLASHW_ALL | FLASHW_TIMERNOFG` with a count of u32::MAX,
      // i.e. keep flashing until the window comes to the foreground. That is
      // the behaviour Discord has and the one that survives being away from
      // the desk, which is the only time any of this matters.
      //
      // Safe to call unconditionally: tao returns early when this window is
      // already the active one and not minimized, so a message arriving while
      // you are reading does not flash anything.
      if (isTauri()) {
        getCurrentWindow()
          .requestUserAttention(UserAttentionType.Critical)
          .catch(() => {});
      }

      // Browser fallback with click handler
      if (!('__TAURI__' in window || '__TAURI_INTERNALS__' in window) && 'Notification' in window) {
        const noti = new window.Notification('Invitation', {
          icon: LogoSVG,
          badge: LogoSVG,
          body: `You have ${count} new invitation request.`,
          silent: true,
        });
        noti.onclick = () => {
          if (!window.closed) navigate(getInboxInvitesPath());
          noti.close();
        };
      }
    },
    [navigate],
  );

  const playSound = useCallback(() => {
    const audioElement = audioRef.current;
    audioElement?.play();
  }, []);

  useEffect(() => {
    if (invites.length > perviousInviteLen && mx.getSyncState() === 'SYNCING') {
      if (showNotifications && isNotificationPermissionGrantedSync()) {
        notify(invites.length - perviousInviteLen);
      }

      if (notificationSound) {
        playSound();
      }
    }
  }, [mx, invites, perviousInviteLen, showNotifications, notificationSound, notify, playSound]);

  return (
    <audio ref={audioRef} style={{ display: 'none' }}>
      <source src={InviteSound} type="audio/ogg" />
    </audio>
  );
}

function MessageNotifications() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const unreadCacheRef = useRef<Map<string, UnreadInfo>>(new Map());
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const [showNotifications] = useSetting(settingsAtom, 'showNotifications');
  const [notificationSound] = useSetting(settingsAtom, 'isNotificationSounds');
  const [notificationContentMode] = useSetting(settingsAtom, 'notificationContentMode');

  const { navigateRoom } = useRoomNavigate();
  const windowFocusedRef = useWindowFocusedRef();
  const notificationSelected = useInboxNotificationsSelected();
  const selectedRoomId = useSelectedRoom();
  const mDirects = useAtomValue(mDirectAtom);
  const roomToParents = useAtomValue(roomToParentsAtom);

  const notify = useCallback(
    ({
      title,
      roomAvatar,
      notificationBody,
      roomId,
      eventId,
    }: {
      title: string;
      roomAvatar?: string;
      notificationBody: string;
      roomId: string;
      eventId: string;
    }) => {
      // Authenticated media (Matrix 1.11+ / MSC3916) requires a Bearer
      // token. The Rust icon cacher fetches the bytes server-side, so
      // forward the access token when the room avatar URL points at the
      // authenticated download endpoint.
      const accessToken = mx.getAccessToken();
      const iconAuthHeader = useAuthentication && accessToken ? `Bearer ${accessToken}` : undefined;

      // sendDesktopNotification's own browser fallback fires a *second*
      // toast with no click handler, which doubles up notifications on
      // web. Only call it in Tauri; the explicit browser fallback below
      // owns the web path and adds the navigate-on-click behaviour.
      if (isTauri()) {
        sendDesktopNotification(title, {
          icon: roomAvatar,
          iconAuthHeader,
          iconHomeserver: mx.baseUrl,
          body: notificationBody,
          roomId,
          eventId,
          // Decrypted message content otherwise lands verbatim in the Windows
          // Action Center or the Android notification store, both of which
          // persist it and expose it to other software on the device — which
          // weakens end-to-end encryption for anyone who assumes plaintext
          // stays inside the app. The user chooses how much is shown.
          contentMode: notificationContentMode,
        });
      }

      // Browser fallback with click handler
      if (!('__TAURI__' in window || '__TAURI_INTERNALS__' in window) && 'Notification' in window) {
        const noti = new window.Notification(title, {
          icon: roomAvatar,
          badge: roomAvatar,
          body: notificationBody,
          silent: true,
          // Tagged per room rather than closing the previous notification
          // outright. One `notifRef` meant a message in room A vanished the
          // moment room B produced one, so a burst across rooms left evidence
          // of only the last. Same-room notifications still replace each other,
          // which is what a tag is for.
          tag: roomId,
        });
        noti.onclick = () => {
          // Open the message itself. This used to land on the inbox, which is
          // the one place the user did not ask to be — the Tauri path above has
          // always carried roomId/eventId through to the native toast.
          if (!window.closed) navigateRoom(roomId, eventId);
          noti.close();
        };
      }
    },
    [navigateRoom, mx, useAuthentication, notificationContentMode],
  );

  const playSound = useCallback(() => {
    const audioElement = audioRef.current;
    audioElement?.play();
  }, []);

  useEffect(() => {
    const sendNotif = (mEvent: any, room: any) => {
      if (!showNotifications || !isNotificationPermissionGrantedSync()) return;
      const sender = mEvent.getSender();
      const eventId = mEvent.getId();
      if (!sender || !eventId || sender === mx.getUserId()) return;

      const unreadInfo = getUnreadInfo(room);
      const cachedUnreadInfo = unreadCacheRef.current.get(room.roomId);
      unreadCacheRef.current.set(room.roomId, unreadInfo);
      if (unreadInfo.total === 0) return;
      if (
        cachedUnreadInfo &&
        unreadEqual(unreadInfoToUnread(cachedUnreadInfo), unreadInfoToUnread(unreadInfo))
      ) {
        return;
      }

      const senderMember = room.getMember(sender);
      const avatarMxc =
        senderMember?.getMxcAvatarUrl() ??
        room.getAvatarFallbackMember()?.getMxcAvatarUrl() ??
        room.getMxcAvatarUrl();
      const username = getMemberDisplayName(room, sender) ?? getMxIdLocalPart(sender) ?? sender;
      const content = (mEvent as any).content ?? mEvent.getContent();
      const msgtype: string | undefined = content?.msgtype;
      let rawBody: string = typeof content?.body === 'string' ? content.body : '';
      if (!rawBody && content?.['m.new_content']?.body) {
        rawBody = content['m.new_content'].body;
      }

      // Title is sender name (like Discord), body is just the message
      let notificationBody: string;
      if (!rawBody && !msgtype) {
        notificationBody = 'New message';
      } else if (msgtype === 'm.image') {
        notificationBody = rawBody ? `📷 ${rawBody}` : 'Sent an image';
      } else if (msgtype === 'm.video') {
        notificationBody = rawBody ? `🎬 ${rawBody}` : 'Sent a video';
      } else if (msgtype === 'm.audio') {
        // A voice message's body is the literal string "Voice message", so the
        // generic audio path would announce "🎵 Voice message" — say what it
        // actually is instead.
        notificationBody = isVoiceMessageContent(content ?? {})
          ? '🎤 Sent a voice message'
          : rawBody
            ? `🎵 ${rawBody}`
            : 'Sent an audio clip';
      } else if (msgtype === 'm.file') {
        notificationBody = rawBody ? `📎 ${rawBody}` : 'Sent a file';
      } else {
        notificationBody = rawBody || 'New message';
      }

      // Discord-style title. A DM is titled by whoever sent it — the room name
      // would just repeat them. Anywhere else the sender alone is ambiguous
      // across rooms, so the room, and the space it belongs to, come with it.
      const isDM = mDirects.has(room.roomId);
      let title: string;
      if (isDM) {
        title = username;
      } else {
        const roomName = room.name ?? 'Unknown';
        const parentRoomId = roomToParents.get(room.roomId)?.values().next().value;
        const parentName = parentRoomId ? mx.getRoom(parentRoomId)?.name : undefined;
        title = parentName
          ? `${username} (#${roomName}, ${parentName})`
          : `${username} (#${roomName})`;
      }

      notify({
        title,
        roomAvatar: avatarMxc
          ? (mxcUrlToHttp(mx, avatarMxc, useAuthentication, 96, 96, 'crop') ?? undefined)
          : undefined,
        notificationBody,
        roomId: room.roomId,
        eventId,
      });

      // Flash the taskbar button until the window is looked at.
      //
      // `Critical`, not `Informational`. They are not degrees of loudness:
      // tao maps Informational to `(FLASHW_TRAY, 4)` — exactly four blinks and
      // then silence, which is over before you glance at the taskbar and is
      // indistinguishable from nothing if you were not already looking.
      // Critical is `FLASHW_ALL | FLASHW_TIMERNOFG` with a count of u32::MAX,
      // i.e. keep flashing until the window comes to the foreground. That is
      // the behaviour Discord has and the one that survives being away from
      // the desk, which is the only time any of this matters.
      //
      // Safe to call unconditionally: tao returns early when this window is
      // already the active one and not minimized, so a message arriving while
      // you are reading does not flash anything.
      if (isTauri()) {
        getCurrentWindow()
          .requestUserAttention(UserAttentionType.Critical)
          .catch(() => {});
      }
    };

    const handleTimelineEvent: RoomEventHandlerMap[RoomEvent.Timeline] = (
      mEvent,
      room,
      toStartOfTimeline,
      removed,
      data,
    ) => {
      if (mx.getSyncState() !== 'SYNCING') return;
      // Focus is read from the Tauri window when available: document.hasFocus()
      // can report false inside a WebView while the window is plainly in front
      // of the user, which is how OS toasts ended up firing at someone already
      // looking at the app.
      const focused = windowFocusedRef.current;
      if (focused && (selectedRoomId === room?.roomId || notificationSelected)) return;
      if (
        !room ||
        !data.liveEvent ||
        room.isSpaceRoom() ||
        !isNotificationEvent(mEvent) ||
        getNotificationType(mx, room.roomId) === NotificationType.Mute
      ) {
        return;
      }
      if (mEvent.getSender() === mx.getUserId()) return;

      // For encrypted messages, the Timeline event fires before decryption
      // completes. Wait for the Decrypted event to get the real content.
      if ((mEvent as any).isEncrypted?.()) {
        const onDecrypted = () => {
          mEvent.off?.(MatrixEventEvent.Decrypted, onDecrypted);
          // An OS toast is for when you are NOT looking at the app. While the
          // window has focus the unread badge and the sound already tell you,
          // so a toast on top of that is pure noise — even for another room.
          if (!windowFocusedRef.current) sendNotif(mEvent, room);
          if (notificationSound) playSound();
        };
        mEvent.on?.(MatrixEventEvent.Decrypted, onDecrypted);
        return;
      }

      if (!windowFocusedRef.current) sendNotif(mEvent, room);
      if (notificationSound) playSound();
    };
    mx.on(RoomEvent.Timeline, handleTimelineEvent);
    return () => {
      mx.removeListener(RoomEvent.Timeline, handleTimelineEvent);
    };
  }, [
    mx,
    notificationSound,
    notificationSelected,
    showNotifications,
    playSound,
    notify,
    selectedRoomId,
    useAuthentication,
    windowFocusedRef,
    mDirects,
    roomToParents,
  ]);

  // Prime the Tauri-desktop notification permission cache. The plugin's
  // init-iife.js short-circuits Windows to `denied` without ever asking
  // Rust, so the Settings UI surfaces the Enable button on every fresh
  // launch even though Rust's permission_state is hardcoded to Granted.
  useEffect(() => {
    primeDesktopNotificationPermission();
    // Android's is a real OS permission, and until now nothing ever asked for
    // it outside Settings — so a fresh install posted nothing anywhere.
    ensureAndroidNotificationPermission();
  }, []);

  // Read through a ref rather than captured, and see the effect below for why
  // that is load-bearing rather than tidiness.
  const navigateRoomRef = useRef(navigateRoom);
  navigateRoomRef.current = navigateRoom;

  // Handle notification clicks: bring window to foreground and navigate to room
  //
  // Registered ONCE, on mount, with the navigation reached through a ref —
  // the same shape `useUpdateCheck` uses for its install action, and for the
  // same reason.
  //
  // Keying this on `navigateRoom` was the bug behind "clicking the toast opens
  // a card with a View button instead of the chat". `navigateRoom` changes
  // identity whenever `mDirects`, `roomToParents` or the selected space
  // changes, and the first two of those are still EMPTY when this effect first
  // runs: `useBindAtoms` lives in `ClientBindAtoms`, which is this component's
  // parent, and React runs child effects before parent effects. So the first
  // listener is registered with a `navigateRoom` that believes there are no
  // DMs and no spaces — and that one sends every DM to `/home/<roomId>`, which
  // `HomeRouteRoomProvider` rejects (a DM is not an orphan room) and renders
  // `JoinBeforeNavigate` for: the room-preview card, one click short of the
  // conversation. Exactly what switching this path to `navigateRoom` was meant
  // to fix, arriving through a stale copy of the fix.
  //
  // Re-registering did not replace that listener either. `onNotificationAction`
  // resolves over IPC, so the cleanup for a dependency change that lands in the
  // same tick runs while `unlisten` is still undefined, and the stale listener
  // stays subscribed for the life of the session. Tauri then delivers an event
  // to every subscriber with no ordering guarantee between them (the Rust side
  // iterates a HashMap of handlers), so with both alive it was a coin toss
  // which `navigateRoom` got the last word — which is why this misbehaved
  // intermittently rather than always.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    onNotificationAction(({ roomId, eventId }) => {
      if (roomId) {
        // navigateRoom, not a hardcoded Home path. A room that lives in a
        // space or is a DM is not in Home's list, so /home/<roomId> rendered
        // the room-preview card instead of the timeline — clicking the toast
        // put you one click short of the conversation every time. This picks
        // the space/direct/home route the rest of the app uses.
        navigateRoomRef.current(roomId, eventId);
      }
      getCurrentWindow()
        .setFocus()
        .catch(() => {});
      getCurrentWindow()
        .show()
        .catch(() => {});
      getCurrentWindow()
        .unminimize()
        .catch(() => {});
    }).then((fn) => {
      // Unsubscribing a registration that only resolved after unmount: without
      // this the listener outlives the component, which is the leak that kept
      // the stale closures above alive.
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // Web push notification clicks: the SW posts a message picked up in
  // src/index.tsx and re-broadcast as a window CustomEvent.
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as
        { roomId?: string; eventId?: string } | undefined;
      if (!detail?.roomId) return;
      navigateRoom(detail.roomId, detail.eventId);
    };
    window.addEventListener('cinny:notification-click', handler);
    return () => window.removeEventListener('cinny:notification-click', handler);
  }, [navigateRoom]);

  return (
    <audio ref={audioRef} style={{ display: 'none' }}>
      <source src={NotificationSound} type="audio/ogg" />
    </audio>
  );
}

/**
 * Joins the rooms of spaces that opted in, globally rather than from the space
 * lobby: a space you never open still gains rooms, and the point of the setting
 * is not having to visit each one.
 */
function SpaceAutoJoinFeature() {
  useSpaceAutoJoinGlobal();
  return null;
}

type ClientNonUIFeaturesProps = {
  children: ReactNode;
};

export function ClientNonUIFeatures({ children }: ClientNonUIFeaturesProps) {
  return (
    <>
      <SystemEmojiFeature />
      <PageZoomFeature />
      <FaviconUpdater />
      <TaskbarBadgeUpdater />
      <SystemTray />
      <InviteNotifications />
      <MessageNotifications />
      <GlobalKeybinds />
      <MatrixLinkHandler />
      <BotStartLinkHandler />
      <ShareTargetHandler />
      <SpaceAutoJoinFeature />
      <RichPresencePublisher />
      {children}
    </>
  );
}
