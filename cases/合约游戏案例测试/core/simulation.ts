/** Descriptive rarity only: no stake, reward, balance or redemption value. */
export function simulationMultiplier(probability: number, sampleSize: number): number | null {
  if (!Number.isFinite(probability) || probability <= 0 || probability > 1 ||
      !Number.isSafeInteger(sampleSize) || sampleSize <= 0) return null;
  const capped = Math.min(20, 1 / probability);
  return Math.round((capped + Number.EPSILON * capped) * 100) / 100;
}
