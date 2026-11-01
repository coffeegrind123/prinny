import { useCallback, useState } from 'react';
import {
  Box,
  Button,
  Header,
  Icon,
  IconButton,
  Icons,
  Modal,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Spinner,
  Text,
  color,
  config,
} from 'folds';
import { FocusTrap } from 'focus-trap-react';
import { MsgType, Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { stopPropagation } from '../../../utils/keyboard';
import { useAlive } from '../../../hooks/useAlive';
import { useMapStyleUrl } from '../../../hooks/useMapStyleUrl';
import { MapView } from '../../../components/map';
import { LIVE_SHARE_DURATIONS, useLiveLocationShare } from './LiveLocationBanner';
import { errorMessage } from '../../../utils/errorMessage';

type Position = { latitude: number; longitude: number };

/**
 * MSC3488 asset types: whether the pin is where the sender is, or a place they
 * are pointing at. Receiving clients use it to decide between "Alice's
 * location" and "a pin Alice dropped".
 */
const ASSET_SELF = 'm.self';
const ASSET_PIN = 'm.pin';

const describeError = (e: unknown): string => {
  if (typeof GeolocationPositionError !== 'undefined' && e instanceof GeolocationPositionError) {
    if (e.code === e.PERMISSION_DENIED)
      return 'Location access was denied. Allow it for Prinny in your system settings.';
    if (e.code === e.POSITION_UNAVAILABLE) return 'Your position could not be determined.';
    if (e.code === e.TIMEOUT) return 'Timed out while finding your position.';
  }
  return 'Could not get your location.';
};

type LocationPickerProps = {
  room: Room;
  threadRootId?: string;
  requestClose: () => void;
};

export function LocationPicker({ room, threadRootId, requestClose }: LocationPickerProps) {
  const mx = useMatrixClient();
  const alive = useAlive();
  const styleUrl = useMapStyleUrl();

  const [position, setPosition] = useState<Position>();
  const [isSelf, setIsSelf] = useState(true);
  const liveShare = useLiveLocationShare(room);
  const [liveError, setLiveError] = useState<string>();
  const [startingLive, setStartingLive] = useState(false);

  const [locateState, locate] = useAsyncCallback<Position, Error, []>(
    useCallback(
      () =>
        new Promise<Position>((resolve, reject) => {
          if (!navigator.geolocation) {
            reject(new Error('This device cannot report a location.'));
            return;
          }
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const next = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
              setPosition(next);
              setIsSelf(true);
              resolve(next);
            },
            (err) => reject(err),
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
          );
        }),
      [],
    ),
  );

  const [sendState, send] = useAsyncCallback<void, Error, [Position, boolean]>(
    useCallback(
      async (pos, self) => {
        const geoUri = `geo:${pos.latitude},${pos.longitude}`;
        const description = self ? 'Shared their location' : 'Shared a location';

        await mx.sendMessage(room.roomId, {
          msgtype: MsgType.Location,
          body: description,
          geo_uri: geoUri,
          // MSC3488 extensible-event form, alongside the plain fields every
          // client already understands.
          'org.matrix.msc3488.location': {
            uri: geoUri,
            description,
          },
          'org.matrix.msc3488.asset': {
            type: self ? ASSET_SELF : ASSET_PIN,
          },
          'org.matrix.msc3488.ts': Date.now(),
          'org.matrix.msc1767.text': `${description}: ${geoUri}`,
          ...(threadRootId
            ? {
                'm.relates_to': {
                  rel_type: 'm.thread',
                  event_id: threadRootId,
                  is_falling_back: true,
                  'm.in_reply_to': { event_id: threadRootId },
                },
              }
            : undefined),
        } as never);
      },
      [mx, room.roomId, threadRootId],
    ),
  );

  const locating = locateState.status === AsyncStatus.Loading;
  const sending = sendState.status === AsyncStatus.Loading;

  const handleSend = () => {
    if (!position) return;
    send(position, isSelf).then(() => {
      if (alive()) requestClose();
    });
  };

  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            clickOutsideDeactivates: true,
            onDeactivate: requestClose,
            escapeDeactivates: stopPropagation,
          }}
        >
          <Modal size="300" flexHeight>
            <Box grow="Yes" direction="Column">
              <Header
                size="500"
                style={{ padding: config.space.S200, paddingLeft: config.space.S400 }}
              >
                <Box grow="Yes">
                  <Text size="H4">Share Location</Text>
                </Box>
                <Box shrink="No">
                  <IconButton size="300" radii="300" onClick={requestClose}>
                    <Icon src={Icons.Cross} />
                  </IconButton>
                </Box>
              </Header>

              <Box direction="Column" gap="400" style={{ padding: config.space.S400 }}>
                {styleUrl ? (
                  <>
                    <MapView
                      styleUrl={styleUrl}
                      height="260px"
                      pins={position ? [{ ...position, live: false }] : []}
                      center={position}
                      zoom={position ? 15 : 1}
                      onPick={(pos) => {
                        setPosition(pos);
                        // A pin the user dropped is a place, not where they are.
                        setIsSelf(false);
                      }}
                    />
                    <Text size="T200" priority="300">
                      Tap the map to drop a pin, or use your own position.
                    </Text>
                  </>
                ) : (
                  <Text size="T200" priority="300">
                    No map is configured, so a location can still be sent but not previewed here.
                    Your homeserver publishes no tile server and none is set in the app config.
                  </Text>
                )}

                <Box gap="200" wrap="Wrap">
                  <Button
                    size="300"
                    radii="300"
                    variant="Secondary"
                    fill="Soft"
                    outlined
                    onClick={() => locate()}
                    disabled={locating || sending}
                    before={
                      locating ? (
                        <Spinner size="200" variant="Secondary" />
                      ) : (
                        <Icon size="50" src={Icons.Pin} />
                      )
                    }
                  >
                    <Text size="B300">Use my location</Text>
                  </Button>
                </Box>

                {position && (
                  <Text size="T200" priority="300">
                    {`${isSelf ? 'Your position' : 'Dropped pin'}: ${position.latitude.toFixed(
                      5,
                    )}, ${position.longitude.toFixed(5)}`}
                  </Text>
                )}

                {locateState.status === AsyncStatus.Error && (
                  <Text size="T200" style={{ color: color.Critical.Main }}>
                    {describeError(locateState.error)}
                  </Text>
                )}
                {sendState.status === AsyncStatus.Error && (
                  <Text size="T200" style={{ color: color.Critical.Main }}>
                    The location could not be sent.
                  </Text>
                )}

                <Text size="T200" priority="300">
                  Anyone in this room, and their servers, can see where this points. There is no way
                  to unsend it.
                </Text>

                <Box direction="Column" gap="100">
                  <Text size="L400">Or share live</Text>
                  <Text size="T200" priority="300">
                    Your position is published to this room every 30 seconds until the time runs out
                    or you stop it. A banner stays visible the whole time.
                  </Text>
                  <Box gap="100" wrap="Wrap">
                    {LIVE_SHARE_DURATIONS.map((duration) => (
                      <Button
                        key={duration.ms}
                        size="300"
                        radii="Pill"
                        variant="Secondary"
                        fill="Soft"
                        outlined
                        disabled={startingLive || liveShare.sharing || sending}
                        onClick={() => {
                          setLiveError(undefined);
                          setStartingLive(true);
                          liveShare
                            .start(duration.ms)
                            .then(() => {
                              if (alive()) requestClose();
                            })
                            .catch((e: Error) => {
                              if (!alive()) return;
                              setStartingLive(false);
                              setLiveError(errorMessage(e, 'Could not start sharing.'));
                            });
                        }}
                      >
                        <Text size="B300">{duration.label}</Text>
                      </Button>
                    ))}
                  </Box>
                  {liveError && (
                    <Text size="T200" style={{ color: color.Critical.Main }}>
                      {liveError}
                    </Text>
                  )}
                </Box>

                <Button
                  variant="Primary"
                  onClick={handleSend}
                  disabled={!position || sending}
                  before={
                    sending ? <Spinner size="200" fill="Solid" variant="Primary" /> : undefined
                  }
                >
                  <Text size="B400">Send</Text>
                </Button>
              </Box>
            </Box>
          </Modal>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}
