import { IndexedDBStore, MatrixClient, MatrixEvent, RoomEvent } from 'matrix-js-sdk';

// IndexedDBStore writes the sync accumulator at most once every five minutes,
// so receipts and cleared notification counts learned since the last write
// were lost on close (or when Android killed the app), and the next start
// restored badges from before those rooms were read until the first sync.
const MIN_FLUSH_INTERVAL_MS = 5000;
// Our own receipt reaches the store only once /sync echoes it, and a write
// serialises the whole accumulator, so trail it rather than chase each one.
const RECEIPT_FLUSH_DELAY_MS = 60000;

const cleanupByClient = new WeakMap<MatrixClient, () => void>();

type ReceiptContent = Record<string, Record<string, Record<string, unknown>>>;

const hasOwnReceipt = (event: MatrixEvent, userId: string): boolean =>
  Object.values(event.getContent<ReceiptContent>()).some((byType) =>
    Object.values(byType ?? {}).some((byUser) => !!byUser && userId in byUser),
  );

/**
 * Writes the sync store when the page is hidden or closed, and a minute after
 * the server echoes one of our receipts. Must be disposed before the store is
 * cleared: the pagehide of the reload that follows would otherwise write the
 * old cache straight back.
 */
export const installSyncStorePersistence = (mx: MatrixClient): void => {
  cleanupByClient.get(mx)?.();
  const { store } = mx;
  if (!(store instanceof IndexedDBStore)) return;

  let lastFlushTs = 0;
  let flushing = false;
  let receiptTimer: number | undefined;

  const flush = (): boolean => {
    const now = Date.now();
    if (flushing || now - lastFlushTs < MIN_FLUSH_INTERVAL_MS) return false;
    flushing = true;
    lastFlushTs = now;
    store
      .save(true)
      .catch((err: unknown) => {
        console.warn('[storage] could not write the sync cache:', err);
      })
      .finally(() => {
        flushing = false;
      });
    return true;
  };

  const scheduleReceiptFlush = () => {
    if (receiptTimer !== undefined) return;
    receiptTimer = window.setTimeout(() => {
      receiptTimer = undefined;
      if (!flush()) scheduleReceiptFlush();
    }, RECEIPT_FLUSH_DELAY_MS);
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') flush();
  };
  const onPageHide = () => {
    flush();
  };
  const onReceipt = (event: MatrixEvent) => {
    const userId = mx.getUserId();
    if (userId && hasOwnReceipt(event, userId)) scheduleReceiptFlush();
  };

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', onPageHide);
  mx.on(RoomEvent.Receipt, onReceipt);

  cleanupByClient.set(mx, () => {
    if (receiptTimer !== undefined) window.clearTimeout(receiptTimer);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pagehide', onPageHide);
    mx.removeListener(RoomEvent.Receipt, onReceipt);
    cleanupByClient.delete(mx);
  });
};

export const disposeSyncStorePersistence = (mx: MatrixClient): void => {
  cleanupByClient.get(mx)?.();
};
