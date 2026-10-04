export interface SpeakerState {
  id: string | null;
  lastLoudAt: number;
}

export interface SpeakerOptions {
  /** Audio level (0 to 1) that counts as speaking. */
  threshold?: number;
  /** Keep highlighting a speaker this long after they go quiet. */
  holdMs?: number;
  /** A challenger must be this many times louder to take over. */
  switchRatio?: number;
}

/**
 * Chooses who to highlight from per-person audio levels. Hysteresis stops the
 * highlight flickering between people during normal conversation.
 */
export function pickActiveSpeaker(
  levels: Record<string, number>,
  prev: SpeakerState,
  now: number,
  { threshold = 0.02, holdMs = 700, switchRatio = 1.3 }: SpeakerOptions = {},
): SpeakerState {
  let loudest: string | null = null;
  for (const [id, level] of Object.entries(levels)) {
    if (level >= threshold && (loudest === null || level > (levels[loudest] ?? 0))) loudest = id;
  }

  if (loudest === null) {
    const stillHeld = prev.id !== null && now - prev.lastLoudAt < holdMs;
    return stillHeld ? prev : { id: null, lastLoudAt: prev.lastLoudAt };
  }

  if (prev.id !== null && prev.id !== loudest) {
    const current = levels[prev.id] ?? 0;
    const challenger = levels[loudest] ?? 0;
    if (current >= threshold && challenger < current * switchRatio) return { id: prev.id, lastLoudAt: now };
  }
  return { id: loudest, lastLoudAt: now };
}
