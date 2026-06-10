/**
 * Suggest the closest candidate for a mistyped identifier, or undefined when
 * nothing is close enough to be a plausible typo.
 */
export function suggestClosest(input: string, candidates: readonly string[]): string | undefined {
  const normalized = input.toLowerCase();
  const maxDistance = Math.max(2, Math.floor(normalized.length / 3));
  let best: { candidate: string; distance: number } | undefined;

  for (const candidate of candidates) {
    const distance = levenshtein(normalized, candidate.toLowerCase());
    if (distance > maxDistance || distance >= candidate.length) continue;
    if (!best || distance < best.distance) {
      best = { candidate, distance };
    }
  }

  return best?.candidate;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + substitutionCost,
      );
    }
    previous = current;
  }

  return previous[b.length]!;
}
