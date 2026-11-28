// The recipe editor's working copy, its checks (DESIGN §5.2, PHASE_3
// "Validation"), and the fields it saves. Pure TypeScript.
import type { CatalogueFields } from '#lib/stores/catalogue.svelte.js';
import { maxNameLength } from './names.js';

export const maxNotesLength = 10_000;
export const maxLines = 200;

export interface DraftLine {
  /** Stable while editing, for keyed lists and ids; not saved. */
  readonly key: string;
  ingredientId: string | null;
  /** `null` when the field is empty. */
  quantity: number | null;
}

export interface RecipeDraft {
  name: string;
  servings: number | null;
  notes: string;
  lines: DraftLine[];
}

export interface LineErrors {
  ingredient?: 'ingredientRequired';
  quantity?: 'quantityRequired';
}

/** Message keys under `recipe.errors`, per field and per line key. */
export interface RecipeErrors {
  name?: 'nameRequired' | 'nameTooLong';
  servings?: 'servingsRequired';
  notes?: 'notesTooLong';
  tooManyLines?: true;
  lines: Record<string, LineErrors>;
}

const positive = (value: number | null): value is number =>
  value !== null && Number.isFinite(value) && value > 0;

/** A line with neither an ingredient nor a quantity: left out when saving. */
export const isBlank = (line: DraftLine) => line.ingredientId === null && line.quantity === null;

export function recipeErrors(draft: RecipeDraft): RecipeErrors {
  const errors: RecipeErrors = { lines: {} };
  const name = draft.name.trim();
  if (!name) errors.name = 'nameRequired';
  else if (name.length > maxNameLength) errors.name = 'nameTooLong';
  if (!positive(draft.servings)) errors.servings = 'servingsRequired';
  if (draft.notes.length > maxNotesLength) errors.notes = 'notesTooLong';
  const lines = draft.lines.filter((line) => !isBlank(line));
  if (lines.length > maxLines) errors.tooManyLines = true;
  for (const line of lines) {
    const lineErrors: LineErrors = {};
    if (line.ingredientId === null) lineErrors.ingredient = 'ingredientRequired';
    if (!positive(line.quantity)) lineErrors.quantity = 'quantityRequired';
    if (lineErrors.ingredient || lineErrors.quantity) errors.lines[line.key] = lineErrors;
  }
  return errors;
}

export function hasErrors(errors: RecipeErrors): boolean {
  return (
    errors.name !== undefined ||
    errors.servings !== undefined ||
    errors.notes !== undefined ||
    errors.tooManyLines !== undefined ||
    Object.keys(errors.lines).length > 0
  );
}

/** The PUT's fields, for a draft with no errors. */
export function recipeFields(draft: RecipeDraft, deleted: boolean): CatalogueFields<'recipes'> {
  return {
    name: draft.name.trim(),
    servings: draft.servings ?? 0,
    notes: draft.notes,
    lines: draft.lines
      .filter((line) => !isBlank(line))
      .map((line) => ({ ingredientId: line.ingredientId ?? '', quantity: line.quantity ?? 0 })),
    deleted
  };
}
