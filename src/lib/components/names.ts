// Names are 1–100 characters once trimmed (DESIGN §5.2).

export const maxNameLength = 100;

/** The `people.*` message for a bad name, or `null` if it's fine. */
export type NameError = 'nameRequired' | 'nameTooLong';

export function nameError(value: string): NameError | null {
  const trimmed = value.trim();
  if (!trimmed) return 'nameRequired';
  if (trimmed.length > maxNameLength) return 'nameTooLong';
  return null;
}
