import { useMatrixClient } from './useMatrixClient';
import { useClientConfig } from './useClientConfig';
import { useSetting } from '../state/hooks/settings';
import { settingsAtom } from '../state/settings';

const TILE_SERVER_STABLE = 'm.tile_server';
const TILE_SERVER_UNSTABLE = 'org.matrix.msc3488.tile_server';

/**
 * The MapLibre style URL to draw maps with, or undefined if there is none.
 *
 * Order is homeserver first, then our own config. That order matters: a
 * homeserver that publishes a tile server is offering one it is willing to be
 * associated with, and is usually closer to the user's expectations than
 * anything we would pick for them.
 *
 * Most homeservers publish nothing here, which is exactly why Element's maps so
 * often come up blank. Callers must handle undefined by degrading to a link
 * rather than rendering an empty grey box.
 */
export const useMapStyleUrl = (): string | undefined => {
  const mx = useMatrixClient();
  const config = useClientConfig();

  const wellKnown = mx.getClientWellKnown() as
    Record<string, { map_style_url?: string } | undefined> | undefined;

  const fromServer =
    wellKnown?.[TILE_SERVER_STABLE]?.map_style_url ??
    wellKnown?.[TILE_SERVER_UNSTABLE]?.map_style_url;

  return fromServer ?? config.mapStyleUrl;
};

/**
 * Whether an inline map may be drawn: the user has opted in AND there is a
 * style to draw with.
 *
 * Kept as one hook so no caller can accidentally check the setting without
 * checking the style, and end up rendering a map component that can only fail.
 */
export const useMapsEnabled = (): boolean => {
  const [showMaps] = useSetting(settingsAtom, 'showMaps');
  const styleUrl = useMapStyleUrl();
  return showMaps && !!styleUrl;
};
