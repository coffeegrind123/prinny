// A homeserver can accept a read receipt and never send it back (it drops one
// that is not newer than what it holds), so after a restart the client may have
// no receipt of ours at all for a room we did read. Keep the timestamp of the
// newest event we successfully marked read per room, for `roomHaveUnread` to
// fall back on.
const STORAGE_KEY = 'app.prinny.read_markers';
const MAX_ENTRIES = 1000;

type Markers = Record<string, number>;

const load = (): Markers => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Markers) : {};
  } catch {
    return {};
  }
};

let cache: Markers | undefined;

const save = (markers: Markers) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(markers));
  } catch {
    // Storage unavailable or full: the in-memory value still serves this session.
  }
};

export const getLocalReadTs = (roomId: string): number => {
  cache ??= load();
  return cache[roomId] ?? 0;
};

export const rememberLocalReadTs = (roomId: string, ts: number) => {
  cache ??= load();
  if ((cache[roomId] ?? 0) >= ts) return;
  cache[roomId] = ts;
  const entries = Object.entries(cache);
  if (entries.length > MAX_ENTRIES) {
    entries.sort(([, a], [, b]) => b - a);
    cache = Object.fromEntries(entries.slice(0, MAX_ENTRIES));
  }
  save(cache);
};

/** "Mark unread from here" moves the receipt backwards; the marker must follow. */
export const rewindLocalReadTs = (roomId: string, ts: number) => {
  cache ??= load();
  if ((cache[roomId] ?? 0) <= ts) return;
  cache[roomId] = ts;
  save(cache);
};
