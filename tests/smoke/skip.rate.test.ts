import { describe, expect, test } from '@jest/globals';
import { health } from '../../src/utils';

const MAX_SKIP_RATE = 0.9;
const MIN_SKIP_SAMPLE = 50;

const exceeded = (skipped: number, attempted: number) =>
  health.skipRateExceeded(skipped, attempted, MAX_SKIP_RATE, MIN_SKIP_SAMPLE);

describe('skipRateExceeded', () => {
  test('stays quiet until the sample is big enough to be conclusive', () => {
    // this is what the failing runs looked like: everything skipped, but only
    // ~63-91 transactions got processed before the run died
    expect(exceeded(1, 1)).toBe(false);
    expect(exceeded(49, 49)).toBe(false);
    expect(exceeded(50, 50)).toBe(true);
  });

  test('trips on the observed all-skipped prover outage', () => {
    // 2026-08-21 onwards: gasForVerification was 0 for every transaction
    expect(exceeded(75, 75)).toBe(true);
  });

  test('tolerates the occasional legitimate skip', () => {
    // reorg-window and empty blocks: a handful of skips must not fail the run
    expect(exceeded(5, 100)).toBe(false);
    expect(exceeded(89, 100)).toBe(false);
    expect(exceeded(90, 100)).toBe(true);
  });

  test('never trips when nothing is being skipped', () => {
    expect(exceeded(0, 21398)).toBe(false);
  });
});
