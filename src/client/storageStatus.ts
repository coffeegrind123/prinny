import { useSyncExternalStore } from 'react';

type Listener = () => void;

export enum ClientStorageProblem {
  // IndexedDB failed mid-session and the SDK fell back to memory.
  Degraded = 'degraded',
  // The sync cache could not be opened or rebuilt at startup, so this session runs on memory.
  SyncCacheUnavailable = 'syncCacheUnavailable',
}

export type ClientStorageError = {
  problem: ClientStorageProblem;
  error: Error;
};

let storageError: ClientStorageError | undefined;
const listeners = new Set<Listener>();

const emitChange = () => listeners.forEach((listener) => listener());

export const resetClientStorageError = (): void => {
  storageError = undefined;
  emitChange();
};

export const reportClientStorageError = (error: Error): void => {
  storageError = { problem: ClientStorageProblem.Degraded, error };
  emitChange();
};

export const reportSyncCacheUnavailable = (error: Error): void => {
  storageError = { problem: ClientStorageProblem.SyncCacheUnavailable, error };
  emitChange();
};

const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = (): ClientStorageError | undefined => storageError;

export const useClientStorageError = (): ClientStorageError | undefined =>
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
