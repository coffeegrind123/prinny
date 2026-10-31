import { VideoHTMLAttributes, forwardRef, useCallback, useEffect, useRef } from 'react';
import classNames from 'classnames';
import * as css from './media.css';
import { getPersistedMediaVolume, setPersistedMediaVolume } from '../../utils/mediaVolume';

export const Video = forwardRef<HTMLVideoElement, VideoHTMLAttributes<HTMLVideoElement>>(
  ({ className, ...props }, ref) => {
    const mediaRef = useRef<HTMLVideoElement | null>(null);

    const setRefs = useCallback(
      (el: HTMLVideoElement | null) => {
        mediaRef.current = el;
        if (typeof ref === 'function') {
          ref(el);
        } else if (ref) {
          ref.current = el;
        }
      },
      [ref],
    );

    // Every video started at full volume, so turning one down in the native
    // controls had to be redone on the next. Only the level is remembered:
    // muting stays the caller's, since GIF autoplay depends on starting muted.
    useEffect(() => {
      const el = mediaRef.current;
      if (!el) return undefined;

      el.volume = getPersistedMediaVolume();
      const handleChange = () => setPersistedMediaVolume(el.volume);
      el.addEventListener('volumechange', handleChange);
      return () => {
        el.removeEventListener('volumechange', handleChange);
      };
    }, []);

    return <video className={classNames(css.Video, className)} {...props} ref={setRefs} />;
  },
);
