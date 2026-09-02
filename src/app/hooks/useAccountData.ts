import { useState, useCallback } from 'react';
import { AccountDataEvents } from 'matrix-js-sdk';
import { useMatrixClient } from './useMatrixClient';
import { useAccountDataCallback } from './useAccountDataCallback';
import { AccountDataEvent } from '../../types/matrix/accountData';

/**
 * `keyof AccountDataEvents` is a closed set of the event types the SDK knows
 * about. It does not cover the custom types we read (`in.cinny.spaces`,
 * `im.ponies.*`, `io.element.recent_emoji`) or the runtime-built
 * `m.secret_storage.key.<id>` ones — and TypeScript string-enum members are not
 * assignable to the equivalent string-literal keys even when the type *is*
 * declared, which is why passing `AccountDataEvent.PushRules` fails on its own.
 * Account data is looked up by plain string at runtime, so widen the parameter
 * and narrow once here rather than casting at seven call sites.
 */
export type AccountDataEventType = AccountDataEvent | keyof AccountDataEvents | (string & {});

export function useAccountData(eventType: AccountDataEventType) {
  const mx = useMatrixClient();
  const [event, setEvent] = useState(() => mx.getAccountData(eventType as keyof AccountDataEvents));

  useAccountDataCallback(
    mx,
    useCallback(
      (evt) => {
        if (evt.getType() === eventType) {
          setEvent(evt);
        }
      },
      [eventType, setEvent],
    ),
  );

  return event;
}
