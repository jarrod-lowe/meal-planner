// Meal helpers shared by the planner and the meal editor (DESIGN §2.2, §3.3).

/** A mealtime's servings: its attendees who still exist, each counted once. */
export function servings(
  mealtime: { readonly attendeeIds: readonly string[] },
  attendees: readonly { readonly id: string }[]
): number {
  const known = new Set(attendees.map((attendee) => attendee.id));
  return new Set(mealtime.attendeeIds.filter((id) => known.has(id))).size;
}
