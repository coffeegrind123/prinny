import { ClientEvent, MatrixClient, SyncState } from 'matrix-js-sdk';

type SyncApiInternals = { abortController?: AbortController };

/**
 * Abort the /sync request in flight so the SDK's own error path retries it.
 *
 * After a laptop sleep or an Android doze the long-poll's connection is gone, but nothing tells
 * the browser, so the request waits out its local timeout (poll timeout + 80 s) before the SDK
 * notices. `retryImmediately()` is the supported nudge, but it only acts once the SDK is already
 * in keepalive backoff, which a hung request never reaches. The SDK has no public way to abort
 * just the sync request (`http.abort()` would also kill uploads and sends), so this swaps
 * SyncApi's private AbortController, the way the SDK's own `stop()` aborts it.
 */
export const abortSyncRequest = (mx: MatrixClient): boolean => {
  const syncApi = (mx as unknown as { syncApi?: SyncApiInternals }).syncApi;
  const stalled = syncApi?.abortController;
  if (!syncApi || !(stalled instanceof AbortController)) {
    console.warn('[sync] cannot abort a stalled /sync: SyncApi.abortController is missing');
    return false;
  }

  // Every sync, keepalive and filter request takes this signal, so replace it before aborting
  // or the keepalive that follows would be aborted too, and fail forever.
  syncApi.abortController = new AbortController();

  // The abort lands in the SDK's onSyncError, which waits 2-7 s before its first keepalive.
  const skipBackoff = (state: SyncState) => {
    mx.removeListener(ClientEvent.Sync, skipBackoff);
    if (state === SyncState.Reconnecting || state === SyncState.Error) {
      mx.retryImmediately();
    }
  };
  mx.on(ClientEvent.Sync, skipBackoff);

  stalled.abort();
  return true;
};
