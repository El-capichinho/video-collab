/** Columns for the call grid: side by side for two, a 2x2 for four, 3 across beyond that. */
export function gridColumns(participants: number): number {
  if (participants <= 1) return 1;
  if (participants <= 4) return 2;
  return 3;
}
