// Whether read receipts are paused because the user is idle. Kept outside React
// so the timeline's event handlers can read it synchronously. Only ever true
// while the `idlePausesReadReceipts` setting is on.
let receiptsPaused = false;
const listeners = new Set<() => void>();

/**
 * The window is focused and the user is not idle with receipts paused: new
 * messages can be treated as seen. Identical to `document.hasFocus()` while
 * the setting is off.
 */
export const isUserActive = (): boolean => document.hasFocus() && !receiptsPaused;

export const setReceiptsPaused = (value: boolean): void => {
  if (receiptsPaused === value) {
    return;
  }
  receiptsPaused = value;
  listeners.forEach((listener) => listener());
};

export const subscribeReceiptsPaused = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
