// The meal editor's unsaved work, kept in memory while the user creates a
// recipe for it (PHASE_4 "Create a recipe from the meal editor").
import type { MealDraft } from '#lib/components/meal-draft.js';

/** Everything the meal editor needs to carry on where it left off. */
export interface MealStash {
  /** The meal's id: for a new meal, the one generated for it. */
  id: string;
  /** The mealtime the editor edits. */
  mealtimeId: string;
  draft: MealDraft;
  nameEdited: boolean;
  timeEdited: boolean;
  /** The stored version the draft is based on, and what it saved as then. */
  base: { version: number | undefined; fields: string };
}

/**
 * The stash's key. A new meal is also keyed by the date and slot it was
 * opened with, so another empty cell's **+** starts afresh.
 */
export function mealDraftKey(
  holidayId: string,
  mealId: string,
  date: string | null,
  slot: string | null
): string {
  const where = mealId === 'new' ? JSON.stringify([date ?? '', slot ?? '']) : '';
  return `${holidayId}/${mealId}${where}`;
}

export class MealDrafts {
  readonly #stashes = new Map<string, MealStash>();

  put(key: string, stash: MealStash): void {
    this.#stashes.set(key, structuredClone(stash));
  }

  /** The stash, which is then gone: the editor that takes it owns the draft. */
  take(key: string): MealStash | undefined {
    const stash = this.#stashes.get(key);
    this.#stashes.delete(key);
    return stash;
  }

  clear(key: string): void {
    this.#stashes.delete(key);
  }
}

export const mealDrafts = new MealDrafts();
