import {
  createContext,
  RefObject,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { MatrixClient, Room } from 'matrix-js-sdk';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
  CallEmbed,
  ElementCallThemeKind,
  ElementWidgetActions,
  useClientWidgetApiEvent,
} from '../plugins/call';
import { CallControlEvent } from '../plugins/call/CallControl';
import { useMatrixClient } from './useMatrixClient';
import { ThemeKind, useTheme } from './useTheme';
import { callEmbedAtom, callIdleAtom } from '../state/callEmbed';
import { useResizeObserver } from './useResizeObserver';
import { CallControlState } from '../plugins/call/CallControlState';
import { useCallMembersChange, useCallSession } from './useCall';
import { CallPreferences } from '../state/callPreferences';
import { useCallPreferencesAtom } from '../state/hooks/callPreferences';

const CallEmbedContext = createContext<CallEmbed | undefined>(undefined);

export const CallEmbedContextProvider = CallEmbedContext.Provider;

export const useCallEmbed = (): CallEmbed | undefined => {
  const callEmbed = useContext(CallEmbedContext);

  return callEmbed;
};

const CallEmbedRefContext = createContext<RefObject<HTMLDivElement | null> | undefined>(undefined);
export const CallEmbedRefContextProvider = CallEmbedRefContext.Provider;
export const useCallEmbedRef = (): RefObject<HTMLDivElement | null> => {
  const ref = useContext(CallEmbedRefContext);
  if (!ref) {
    throw new Error('CallEmbedRef is not provided!');
  }
  return ref;
};

export const createCallEmbed = async (
  mx: MatrixClient,
  room: Room,
  dm: boolean,
  themeKind: ElementCallThemeKind,
  container: HTMLElement,
  pref?: CallPreferences,
): Promise<CallEmbed> => {
  const rtcSession = mx.matrixRTC.getRoomSession(room);
  const ongoing = rtcSession.memberships.length > 0;

  const intent = CallEmbed.getIntent(dm, ongoing, pref?.video);
  const widget = CallEmbed.getWidget(mx, room, intent, themeKind);
  const controlState = pref && new CallControlState(pref.microphone, pref.video, pref.sound);

  const embed = new CallEmbed(mx, room, widget, container, controlState);

  return embed;
};

export const useCallStart = (dm = false) => {
  const mx = useMatrixClient();
  const theme = useTheme();
  const setCallEmbed = useSetAtom(callEmbedAtom);
  const callEmbedRef = useCallEmbedRef();

  const startCall = useCallback(
    async (room: Room, pref?: CallPreferences) => {
      const container = callEmbedRef.current;
      if (!container) {
        throw new Error('Failed to start call, No embed container element found!');
      }
      const callEmbed = await createCallEmbed(mx, room, dm, theme.kind, container, pref);

      setCallEmbed(callEmbed);
    },
    [mx, dm, theme, setCallEmbed, callEmbedRef],
  );

  return startCall;
};

export const useCallJoined = (embed?: CallEmbed): boolean => {
  const [joined, setJoined] = useState(embed?.joined ?? false);

  useClientWidgetApiEvent(
    embed?.call,
    ElementWidgetActions.JoinCall,
    useCallback(() => {
      setJoined(true);
    }, []),
  );

  useEffect(() => {
    if (!embed) {
      setJoined(false);
    }
  }, [embed]);

  return joined;
};

export const useCallHangupEvent = (embed: CallEmbed, callback: () => void) => {
  // A hangup or close the widget asks for ends the call with no other trace;
  // log which one it was so an unexpected drop can be told apart from a click.
  const onHangup = useCallback(
    (evt: CustomEvent) => {
      console.info('[call] widget requested hangup', evt.detail);
      callback();
    },
    [callback],
  );
  const onClose = useCallback(
    (evt: CustomEvent) => {
      console.info('[call] widget requested close', evt.detail);
      callback();
    },
    [callback],
  );
  useClientWidgetApiEvent(embed.call, ElementWidgetActions.HangupCall, onHangup);
  useClientWidgetApiEvent(embed.call, ElementWidgetActions.Close, onClose);
};

export const useCallMemberSoundSync = (embed: CallEmbed) => {
  const callSession = useCallSession(embed.room);
  useCallMembersChange(
    callSession,
    useCallback(() => embed.control.applySound(), [embed]),
  );
};

/**
 * Remember mic/sound toggles the user makes in a call, so the next call starts the same way.
 * Only user toggles count: state reported by the call widget itself (joins, reconnects) must
 * never overwrite the saved preference.
 */
export const useCallPreferenceSync = (embed: CallEmbed) => {
  const prefAtom = useCallPreferencesAtom();
  const [pref, setPref] = useAtom(prefAtom);
  const prefRef = useRef(pref);
  prefRef.current = pref;

  useEffect(() => {
    const onToggle = (change: Partial<Pick<CallPreferences, 'microphone' | 'sound'>>) => {
      setPref({ ...prefRef.current, ...change });
    };
    embed.control.on(CallControlEvent.UserToggle, onToggle);
    return () => {
      embed.control.off(CallControlEvent.UserToggle, onToggle);
    };
  }, [embed, setPref]);
};

/** Preferences for starting a call: remembered mic/sound state, with the given video choice. */
export const useCallStartPreferences = (): ((video: boolean) => CallPreferences) => {
  const pref = useAtomValue(useCallPreferencesAtom());
  return useCallback(
    (video: boolean) => ({ microphone: pref.microphone, video, sound: pref.sound }),
    [pref],
  );
};

export const useCallThemeSync = (embed: CallEmbed) => {
  const theme = useTheme();

  useEffect(() => {
    const name: ElementCallThemeKind = theme.kind === ThemeKind.Dark ? 'dark' : 'light';

    embed.setTheme(name);
  }, [theme.kind, embed]);
};

export const useCallEmbedPlacementSync = (
  containerViewRef: RefObject<HTMLDivElement | null>,
): void => {
  const callEmbedRef = useCallEmbedRef();

  const syncCallEmbedPlacement = useCallback(() => {
    const embedEl = callEmbedRef.current;
    const container = containerViewRef.current;
    if (!embedEl || !container) return;

    embedEl.style.top = `${container.offsetTop}px`;
    embedEl.style.left = `${container.offsetLeft}px`;
    embedEl.style.width = `${container.clientWidth}px`;
    embedEl.style.height = `${container.clientHeight}px`;
  }, [callEmbedRef, containerViewRef]);

  useResizeObserver(
    syncCallEmbedPlacement,
    useCallback(() => containerViewRef.current, [containerViewRef]),
  );
};

/** Human-readable step the call is on while it connects, for the voice panel. */
export const useCallConnectionStatus = (embed: CallEmbed): string => {
  const [status, setStatus] = useState('Loading call…');

  useEffect(() => {
    setStatus('Loading call…');
    const disposers = [
      embed.onPreparing(() => setStatus('Preparing the call…')),
      embed.onReady(() => setStatus('Call ready, requesting permissions…')),
      embed.onCapabilitiesNotified(() => setStatus('Joining the call…')),
      embed.onPreparingError((error: unknown) =>
        setStatus(`Failed to prepare: ${error instanceof Error ? error.message : String(error)}`),
      ),
    ];
    const onLoad = () => setStatus((prev) => (prev === 'Loading call…' ? 'Starting call…' : prev));
    embed.iframe.addEventListener('load', onLoad);
    return () => {
      disposers.forEach((dispose) => dispose());
      embed.iframe.removeEventListener('load', onLoad);
    };
  }, [embed]);

  return status;
};

const CALL_IDLE_MS = 3000;

/**
 * Tracks pointer/keyboard activity, in the app and inside the call iframe, and sets
 * `callIdleAtom` after a few quiet seconds so the call view can fade its header and controls.
 */
export const useCallIdle = (embed?: CallEmbed) => {
  const setIdle = useSetAtom(callIdleAtom);

  useEffect(() => {
    if (!embed) {
      setIdle(false);
      return undefined;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const attached = new Set<Document>();

    const onActivity = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), CALL_IDLE_MS);
    };

    const events = ['mousemove', 'mousedown', 'keydown', 'wheel'] as const;
    const attach = (doc?: Document) => {
      if (!doc || attached.has(doc)) return;
      attached.add(doc);
      events.forEach((evt) => doc.addEventListener(evt, onActivity, { passive: true }));
    };
    // The iframe swaps its document on load, so attach again each time.
    const attachAll = () => {
      attach(document);
      attach(embed.document);
    };

    attachAll();
    embed.iframe.addEventListener('load', attachAll);
    onActivity();

    return () => {
      clearTimeout(timer);
      embed.iframe.removeEventListener('load', attachAll);
      attached.forEach((doc) => events.forEach((evt) => doc.removeEventListener(evt, onActivity)));
      setIdle(false);
    };
  }, [embed, setIdle]);
};
