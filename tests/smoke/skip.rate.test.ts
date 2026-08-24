import { describe, expect, test } from '@jest/globals';
import { blockNumberFromPath, isExpectedProofSkip } from '../../src/bin/proof-skips';
import { health } from '../../src/utils';

const MAX_UNEXPECTED_SKIP_RATE = 0.9;
const MIN_SKIP_SAMPLE = 50;

const exceeded = (unexpected: number, attempted: number) =>
  health.skipRateExceeded(unexpected, attempted, MAX_UNEXPECTED_SKIP_RATE, MIN_SKIP_SAMPLE);

describe('blockNumberFromPath', () => {
  test('reads the block number encode-blocks put in the path', () => {
    expect(blockNumberFromPath('/var/tmp/encoded-data/25825015/0xf00.txt')).toBe(25825015);
    expect(blockNumberFromPath('/var/tmp/encoded-data/ethers/25825015/0xf00.txt')).toBe(25825015);
  });

  test('returns null for paths without a numeric block directory', () => {
    expect(blockNumberFromPath('/var/tmp/encoded-data/0xf00.txt')).toBeNull();
    expect(blockNumberFromPath('0xf00.txt')).toBeNull();
  });
});

describe('isExpectedProofSkip', () => {
  test('a block newer than the attestation has no proof yet', () => {
    // the state every cron run is in since the encode window was cut to 3
    // minutes: block 25825446 encoded while attestation sat at 25825430
    expect(isExpectedProofSkip('BlockNotOnSourceChain', 25825446, 25825430)).toBe(true);
    expect(isExpectedProofSkip('BlockNotReady', 25825446, 25825430)).toBe(true);
  });

  test('an attested block without a proof is the prover failing', () => {
    expect(isExpectedProofSkip('BlockNotOnSourceChain', 25825430, 25825430)).toBe(false);
    expect(isExpectedProofSkip('BlockNotReady', 25825015, 25825430)).toBe(false);
  });

  test('an empty block has nothing to prove at any height', () => {
    expect(isExpectedProofSkip('EmptyBlockTxProof', 25825015, 25825430)).toBe(true);
  });

  test('gives the prover the benefit of the doubt when a height is unknown', () => {
    expect(isExpectedProofSkip('BlockNotOnSourceChain', null, 25825430)).toBe(true);
    expect(isExpectedProofSkip('BlockNotOnSourceChain', 25825015, null)).toBe(true);
  });
});

describe('skipRateExceeded', () => {
  test('stays quiet until the sample is big enough to be conclusive', () => {
    expect(exceeded(1, 1)).toBe(false);
    expect(exceeded(49, 49)).toBe(false);
    expect(exceeded(50, 50)).toBe(true);
  });

  test('tolerates the occasional unexpected skip', () => {
    expect(exceeded(5, 100)).toBe(false);
    expect(exceeded(89, 100)).toBe(false);
    expect(exceeded(90, 100)).toBe(true);
  });

  test('never trips while skips are all expected', () => {
    // the PR run that decoded 50 not-yet-attested blocks: every skip expected,
    // so nothing unexpected is counted and the run must not fail
    expect(exceeded(0, 50)).toBe(false);
    expect(exceeded(0, 21398)).toBe(false);
  });
});
