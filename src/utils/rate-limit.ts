import axios from 'axios';
import { backOff, BackoffOptions } from 'exponential-backoff';

/**
 * JSON-RPC error code a Creditcoin RPC gateway returns once the caller runs out
 * of request quota. ethers wraps it in a `CALL_EXCEPTION` whose message is the
 * unhelpful 'missing revert data', so the real code has to be dug out of the
 * nested `info.error` payload.
 */
export const RPC_RATE_LIMIT_CODE = -32029;

/**
 * True when `error` is an RPC gateway (or an HTTP API) telling us to slow down,
 * rather than a genuine failure of the call itself.
 *
 * Throttling is transient, so these are the only errors worth retrying —
 * anything else must still propagate.
 *
 * @param error - the value caught from a provider or axios call
 *
 * @example
 * ```ts
 * try {
 *   await contract.getFunction('foo').estimateGas();
 * } catch (error) {
 *   if (!isRateLimitError(error)) throw error;
 * }
 * ```
 */
export function isRateLimitError(error: unknown): boolean {
  if (axios.isAxiosError(error)) {
    return error.response?.status === 429;
  }

  // ethers nests the provider's JSON-RPC error under `info.error`, but plain
  // provider errors also show up unwrapped; check both shapes.
  const candidates = [
    (error as { info?: { error?: unknown } })?.info?.error,
    (error as { error?: unknown })?.error,
    error,
  ];

  return candidates.some(
    (candidate) =>
      typeof candidate === 'object' &&
      candidate !== null &&
      (candidate as { code?: unknown }).code === RPC_RATE_LIMIT_CODE,
  );
}

/**
 * Runs `operation`, backing off and retrying for as long as the far end reports
 * rate limiting. Any other error is thrown on the first attempt.
 *
 * Only wrap read-only, idempotent calls (`estimateGas`, `eth_call`, an HTTP
 * GET) — a retry re-issues the operation verbatim.
 *
 * @param label - name used in the retry log line, e.g. 'verifyAndEmit estimateGas'
 * @param operation - the call to run
 * @param numOfAttempts - total attempts before giving up; delays double from 1s
 *
 * @example
 * ```ts
 * const estimate = await withRateLimitRetry('verifyAndEmit estimateGas', () =>
 *   contract.getFunction(fragment).estimateGas(...args),
 * );
 * ```
 */
export async function withRateLimitRetry<T>(
  label: string,
  operation: () => Promise<T>,
  numOfAttempts: number = 7,
): Promise<T> {
  const backOffOptions = {
    delayFirstAttempt: false,
    jitter: 'full',
    numOfAttempts,
    startingDelay: 1000, // 1s, doubling: ~1+2+4+8+16+32s of patience over 7 attempts
    timeMultiple: 2,
    retry: (error: unknown, attempt: number) => {
      if (!isRateLimitError(error)) {
        return false;
      }
      console.warn(`    ... rate limited on ${label}; retrying (attempt ${attempt})`);
      return true;
    },
  } as BackoffOptions;

  return backOff(operation, backOffOptions);
}
