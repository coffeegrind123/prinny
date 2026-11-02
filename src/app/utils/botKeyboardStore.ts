/**
 * Reply-keyboard state kept in room account data `app.prinny.bot.keyboard`
 * (spec §2.2), so a keyboard survives a reload, a sync gap and the 200-event
 * scan window, and a dismissal follows the user to their other devices.
 *
 *   { "<bot mxid>": { "event_id": "$…", "ts": 1730000000000,
 *                     "kind": "keyboard" | "remove",
 *                     "dismissed"?: true, "used"?: true } }
 *
 * Only references are stored, never the markup. Room account data is not
 * encrypted, so copying a keyboard's buttons into it would put the contents
 * of an E2EE message on the server in plaintext. The markup is read back
 * from the (decrypted) event itself.
 *
 * One entry per bot holds its latest instruction. The newest instruction in
 * the room wins, whichever bot sent it, matching the timeline rule that a
 * `remove_keyboard` hides everything older.
 */

export type InstructionKind = 'keyboard' | 'remove';

export type StoredInstruction = {
  eventId: string;
  ts: number;
  kind: InstructionKind;
  dismissed: boolean;
  used: boolean;
};

export type Instruction = { kind: InstructionKind; eventId: string; ts: number };

type RawContent = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseEntry = (value: unknown): StoredInstruction | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const { event_id: eventId, ts, kind, dismissed, used } = value;
  if (typeof eventId !== 'string' || typeof ts !== 'number') {
    return undefined;
  }
  if (kind !== 'keyboard' && kind !== 'remove') {
    return undefined;
  }
  return { eventId, ts, kind, dismissed: dismissed === true, used: used === true };
};

export const parseStoredKeyboards = (content: unknown): Record<string, StoredInstruction> => {
  const out: Record<string, StoredInstruction> = {};
  if (!isRecord(content)) {
    return out;
  }
  Object.entries(content).forEach(([userId, value]) => {
    if (!userId.startsWith('@')) {
      return;
    }
    const entry = parseEntry(value);
    if (entry) {
      out[userId] = entry;
    }
  });
  return out;
};

/**
 * Content with `botUserId`'s latest instruction replaced, or undefined when
 * the stored one is already this or newer (so callers skip the write).
 */
export const recordInstruction = (
  content: RawContent | undefined,
  botUserId: string,
  instruction: Instruction,
): RawContent | undefined => {
  const current = parseEntry(content?.[botUserId]);
  if (current && (current.eventId === instruction.eventId || current.ts > instruction.ts)) {
    return undefined;
  }
  return {
    ...content,
    [botUserId]: { event_id: instruction.eventId, ts: instruction.ts, kind: instruction.kind },
  };
};

/** Content with a flag set on the named instruction, or undefined if it is not the stored one. */
export const setKeyboardFlag = (
  content: RawContent | undefined,
  botUserId: string,
  eventId: string,
  flag: 'dismissed' | 'used',
): RawContent | undefined => {
  const raw = content?.[botUserId];
  const current = parseEntry(raw);
  if (!current || current.eventId !== eventId || current[flag]) {
    return undefined;
  }
  return { ...content, [botUserId]: { ...(raw as RawContent), [flag]: true } };
};

export const latestInstruction = (
  stored: Record<string, StoredInstruction>,
): (StoredInstruction & { botUserId: string }) | undefined =>
  Object.entries(stored).reduce<(StoredInstruction & { botUserId: string }) | undefined>(
    (latest, [botUserId, entry]) =>
      !latest || entry.ts > latest.ts ? { ...entry, botUserId } : latest,
    undefined,
  );
