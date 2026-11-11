/**
 * How often the composer found itself focused without slate knowing (see `repairEditorFocusFlag`),
 * kept across reloads so Settings › About › Diagnostics can show it. On Android the console is out
 * of reach without a PC, and the question after "text typed backwards" is whether this repair ran.
 */
export type FocusRepairTrigger = 'focus' | 'keydown';

export type FocusRepairStats = {
  focus: number;
  keydown: number;
  lastAt?: number;
  lastTrigger?: FocusRepairTrigger;
};

const STORAGE_KEY = 'app.prinny.composerFocusRepairs';

const EMPTY: FocusRepairStats = { focus: 0, keydown: 0 };

export const addFocusRepair = (
  stats: FocusRepairStats,
  trigger: FocusRepairTrigger,
  now: number,
): FocusRepairStats => ({
  ...stats,
  [trigger]: stats[trigger] + 1,
  lastAt: now,
  lastTrigger: trigger,
});

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

export const parseFocusRepairs = (raw: string | null): FocusRepairStats => {
  if (!raw) return { ...EMPTY };
  let value: Partial<FocusRepairStats>;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ...EMPTY };
  }
  if (!value || !isCount(value.focus) || !isCount(value.keydown)) return { ...EMPTY };

  const stats: FocusRepairStats = { focus: value.focus, keydown: value.keydown };
  if (typeof value.lastAt === 'number') stats.lastAt = value.lastAt;
  if (value.lastTrigger === 'focus' || value.lastTrigger === 'keydown') {
    stats.lastTrigger = value.lastTrigger;
  }
  return stats;
};

export const readFocusRepairs = (): FocusRepairStats => {
  try {
    return parseFocusRepairs(localStorage.getItem(STORAGE_KEY));
  } catch {
    return { ...EMPTY };
  }
};

export const recordFocusRepair = (trigger: FocusRepairTrigger): void => {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(addFocusRepair(readFocusRepairs(), trigger, Date.now())),
    );
  } catch {
    // Storage full or blocked: the repair itself already ran, only the count is lost.
  }
};
