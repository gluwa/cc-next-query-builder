/**
 * Skipping the odd item is normal when an upstream service legitimately has
 * nothing to return: source-chain blocks inside the reorg-protection window, or
 * blocks with no transactions, have no proof to verify. Skipping (nearly)
 * *everything* means that upstream is broken and the check that consumes it is
 * only pretending to run.
 *
 * `skipRateExceeded` is the tripwire for that second case: it reports whether
 * the skip rate has stayed at or above `maxSkipRate` over a sample large enough
 * (`minSample`) to be conclusive, so a caller can fail loudly instead of
 * silently passing.
 *
 * @param skipped - items skipped so far
 * @param attempted - items attempted so far
 * @param maxSkipRate - skip rate, in [0, 1], that is still tolerated
 * @param minSample - attempts required before the rate means anything
 *
 * @example
 * ```ts
 * if (skipRateExceeded(skipped, idx + 1, 0.9, 50)) {
 *   throw new Error('the prover is skipping everything; failing run');
 * }
 * ```
 */
export function skipRateExceeded(skipped: number, attempted: number, maxSkipRate: number, minSample: number): boolean {
  if (attempted < minSample) {
    return false;
  }

  return skipped / attempted >= maxSkipRate;
}
