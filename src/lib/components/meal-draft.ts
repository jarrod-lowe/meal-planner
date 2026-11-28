// The meal editor's working copy (DESIGN §7.4, one-day mode): what it saves,
// and the checks before saving.
import type { Schemas } from '#lib/api/client.js';
import { formatShortDate } from '#lib/format/dates.js';
import { t } from '#lib/i18n/en.js';
import { isLocalDate } from '#lib/model/dates.js';
import type { MealSlot } from '#lib/model/slots.js';
import { nameError, type NameError } from './names.js';

export interface MealDraft {
  name: string;
  slot: MealSlot;
  /** `LocalDate`, or `""` while the date input is empty. */
  date: string;
  /** `HH:mm`, or `""` while the time input is empty. */
  time: string;
  recipeId: string | null;
  attendeeIds: string[];
}

export type MealFields = Omit<Schemas['MealInput'], 'version'>;

export interface MealErrors {
  name?: NameError;
  date?: 'dateRequired';
  time?: 'timeRequired';
}

/** `"2027-01-01"`, `dinner` → `"1 Jan Dinner"` (DESIGN §2.2). */
export function suggestName(date: string, slot: MealSlot): string {
  const slotName = t(`slots.${slot}`);
  return isLocalDate(date)
    ? t('meal.suggestedName', { date: formatShortDate(date), slot: slotName })
    : slotName;
}

export function mealErrors(draft: MealDraft): MealErrors {
  const errors: MealErrors = {};
  const name = nameError(draft.name);
  if (name) errors.name = name;
  if (!isLocalDate(draft.date)) errors.date = 'dateRequired';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/u.test(draft.time)) errors.time = 'timeRequired';
  return errors;
}

export const hasErrors = (errors: MealErrors) => Object.keys(errors).length > 0;

/**
 * What a save sends. The draft is the meal's first mealtime: any later ones
 * (from the several-days mode in phase 5) are kept as they are. Attendees are
 * the holiday's, in its order.
 */
export function mealFields(
  draft: MealDraft,
  mealtime: { readonly id: string; readonly rest: readonly Schemas['Mealtime'][] },
  attendees: readonly { readonly id: string }[]
): MealFields {
  const ticked = new Set(draft.attendeeIds);
  return {
    name: draft.name.trim(),
    slot: draft.slot,
    recipeId: draft.recipeId,
    mealtimes: [
      {
        id: mealtime.id,
        at: `${draft.date}T${draft.time}`,
        attendeeIds: attendees.map((a) => a.id).filter((id) => ticked.has(id))
      },
      ...mealtime.rest
    ]
  };
}
