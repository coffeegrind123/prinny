import { useEffect, useState } from 'react';

/**
 * Whether this device has a camera. Starts as available until the devices are listed (so the
 * button is not briefly disabled on every call), and follows cameras being plugged in or removed.
 * Without labels permission the list still reports `videoinput` entries, just unnamed.
 */
export const useCameraAvailable = (): boolean => {
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    const mediaDevices = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!mediaDevices?.enumerateDevices) return undefined;

    let active = true;
    const check = () => {
      mediaDevices
        .enumerateDevices()
        .then((devices) => {
          if (active) setAvailable(devices.some((d) => d.kind === 'videoinput'));
        })
        .catch(() => undefined);
    };
    check();
    mediaDevices.addEventListener?.('devicechange', check);
    return () => {
      active = false;
      mediaDevices.removeEventListener?.('devicechange', check);
    };
  }, []);

  return available;
};
