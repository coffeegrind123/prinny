import { useEffect } from 'react';
import { isUserActive, subscribeReceiptsPaused } from '../state/idle';

/**
 * Fires when the user starts or stops being able to see new messages: window
 * focus changes, or (with that setting on) going idle and coming back.
 */
export const useDocumentFocusChange = (onChange: (focus: boolean) => void) => {
  useEffect(() => {
    let localFocus = isUserActive();

    const handleFocus = () => {
      const focus = isUserActive();
      if (focus === localFocus) {
        return;
      }
      localFocus = focus;
      onChange(localFocus);
    };

    document.addEventListener('focusin', handleFocus);
    document.addEventListener('focusout', handleFocus);
    const unsubscribe = subscribeReceiptsPaused(handleFocus);
    return () => {
      document.removeEventListener('focusin', handleFocus);
      document.removeEventListener('focusout', handleFocus);
      unsubscribe();
    };
  }, [onChange]);
};
