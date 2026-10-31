export type PersistentFlags = {
  has: (key: string) => boolean;
  set: (key: string) => void;
  clear: (key: string) => void;
  /** For useSyncExternalStore: called after any flag changes. */
  subscribe: (listener: () => void) => () => void;
};

/**
 * Boolean flags kept in localStorage that React can subscribe to. The in-memory copy keeps a
 * flag for the session when storage is blocked, so a choice is never silently lost mid-session.
 */
export const createPersistentFlags = (): PersistentFlags => {
  const memory = new Set<string>();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());

  return {
    has: (key) => {
      if (memory.has(key)) return true;
      try {
        return localStorage.getItem(key) === '1';
      } catch {
        return false;
      }
    },
    set: (key) => {
      memory.add(key);
      try {
        localStorage.setItem(key, '1');
      } catch {
        // Kept for this session only.
      }
      notify();
    },
    clear: (key) => {
      memory.delete(key);
      try {
        localStorage.removeItem(key);
      } catch {
        // Nothing stored to clear.
      }
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
