import { Room } from 'matrix-js-sdk';
import { StateEvent } from '../../types/matrix/room';

/** Content keys that do not make a membership live (MSC4354 sticky events add one). */
const IGNORED_KEYS = new Set(['msc4354_sticky_key']);

/**
 * Whether anyone is in a call in this room, judged as the SDK's own quick
 * filter does: a membership counts only with content beyond the sticky key
 * and an `application`. Leaving a call empties the content, and the old
 * `memberships` list format is ignored, so neither counts.
 */
export const hasActiveCallMembership = (room: Room): boolean =>
  room.currentState.getStateEvents(StateEvent.GroupCallMemberPrefix).some((event) => {
    const content = event.getContent();
    const keys = Object.keys(content).filter((key) => !IGNORED_KEYS.has(key));
    return keys.length > 1 && 'application' in content;
  });
