const STORAGE_KEY = 'mediaVolume';

const clampVolume = (volume: number): number => Math.max(0, Math.min(volume, 1));

/** The video volume last set by the user, 1 when never set or unreadable. */
export const getPersistedMediaVolume = (): number => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return 1;
    const parsed = JSON.parse(raw) as { volume?: unknown } | null;
    return typeof parsed?.volume === 'number' ? clampVolume(parsed.volume) : 1;
  } catch {
    return 1;
  }
};

export const setPersistedMediaVolume = (volume: number): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ volume: clampVolume(volume) }));
  } catch {
    // Private mode or a full quota: the level just is not remembered.
  }
};
