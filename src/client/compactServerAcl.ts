import { ClientEvent, MatrixClient, MatrixEvent } from 'matrix-js-sdk';

const SERVER_ACL = 'm.room.server_acl';
const ACL_LISTS = ['allow', 'deny'] as const;

// JSON parsing gives every event its own copy of each server name. A big room's ACL
// has hundreds of entries and the SDK keeps an event per revision, so the copies
// add up to tens of MB. Sharing one string per name keeps the data and drops the rest.
const names = new Map<string, string>();

const internNames = (content: unknown): void => {
  if (typeof content !== 'object' || content === null) {
    return;
  }
  const record = content as Record<string, unknown>;
  ACL_LISTS.forEach((key) => {
    const list = record[key];
    if (!Array.isArray(list)) {
      return;
    }
    for (let i = 0; i < list.length; i += 1) {
      const name = list[i];
      if (typeof name !== 'string') {
        continue;
      }
      const shared = names.get(name);
      if (shared === undefined) {
        names.set(name, name);
      } else {
        list[i] = shared;
      }
    }
  });
};

const compactServerAclEvent = (mEvent: MatrixEvent): void => {
  if (mEvent.getType() !== SERVER_ACL) {
    return;
  }
  const { event } = mEvent;
  internNames(event.content);
  // The previous ACL is a second full copy of the list, and nothing renders it.
  if (event.unsigned) {
    delete event.unsigned.prev_content;
  }
};

// startClient can be retried on the same client; the off keeps it to one listener.
export const compactServerAcls = (mx: MatrixClient): void => {
  mx.off(ClientEvent.Event, compactServerAclEvent);
  mx.on(ClientEvent.Event, compactServerAclEvent);
};
