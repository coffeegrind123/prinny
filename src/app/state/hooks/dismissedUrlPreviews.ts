import { useAtomValue, useSetAtom } from 'jotai';
import { selectAtom } from 'jotai/utils';
import { useCallback, useMemo } from 'react';
import { dismissedUrlPreviewKey, dismissedUrlPreviewsAtom } from '../dismissedUrlPreviews';

/**
 * Whether this card has been dismissed, and the way to dismiss it.
 *
 * Reads through a selector so a dismissal anywhere in the timeline only
 * re-renders the one card it concerns, rather than every preview on screen.
 */
export const useUrlPreviewDismissed = (url: string, eventId?: string): [boolean, () => void] => {
  const key = dismissedUrlPreviewKey(url, eventId);

  const selector = useMemo(() => (dismissed: Set<string>) => dismissed.has(key), [key]);
  const dismissed = useAtomValue(selectAtom(dismissedUrlPreviewsAtom, selector));

  const putDismissed = useSetAtom(dismissedUrlPreviewsAtom);
  const dismiss = useCallback(() => putDismissed({ type: 'PUT', key }), [putDismissed, key]);

  return [dismissed, dismiss];
};
