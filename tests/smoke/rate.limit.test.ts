import { describe, expect, jest, test } from '@jest/globals';
import { AxiosError, AxiosHeaders } from 'axios';
import { rateLimit } from '../../src/utils';

/**
 * The exact shape ethers produces for a throttled `eth_estimateGas` against
 * the Creditcoin RPC gateway, copied from a failing `decode-transactions` run
 * (GH Actions run 32726863341).
 */
function throttledEstimateGasError(): Error {
  return Object.assign(new Error('missing revert data'), {
    code: 'CALL_EXCEPTION',
    action: 'estimateGas',
    data: null,
    reason: null,
    shortMessage: 'missing revert data',
    info: {
      error: { code: -32029, message: 'Rate limit exceeded', data: {} },
      payload: { method: 'eth_estimateGas', params: [], id: 446, jsonrpc: '2.0' },
    },
  });
}

function axiosErrorWithStatus(status: number): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError('request failed', 'ERR_BAD_RESPONSE', config, null, {
    status,
    statusText: '',
    data: {},
    headers: new AxiosHeaders(),
    config,
  });
}

describe('isRateLimitError', () => {
  test('detects -32029 nested in an ethers CALL_EXCEPTION', () => {
    expect(rateLimit.isRateLimitError(throttledEstimateGasError())).toBe(true);
  });

  test('detects -32029 on an unwrapped provider error', () => {
    expect(rateLimit.isRateLimitError({ error: { code: -32029, message: 'Rate limit exceeded' } })).toBe(true);
    expect(rateLimit.isRateLimitError({ code: -32029, message: 'Rate limit exceeded' })).toBe(true);
  });

  test('detects HTTP 429 from an axios call', () => {
    expect(rateLimit.isRateLimitError(axiosErrorWithStatus(429))).toBe(true);
  });

  test('does not treat other failures as rate limiting', () => {
    expect(rateLimit.isRateLimitError(new Error('execution reverted'))).toBe(false);
    expect(rateLimit.isRateLimitError({ info: { error: { code: -32000, message: 'execution reverted' } } })).toBe(
      false,
    );
    expect(rateLimit.isRateLimitError(axiosErrorWithStatus(422))).toBe(false);
    expect(rateLimit.isRateLimitError(null)).toBe(false);
    expect(rateLimit.isRateLimitError(undefined)).toBe(false);
  });
});

describe('withRateLimitRetry', () => {
  test('retries past rate limiting and returns the eventual result', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const operation = jest
      .fn<() => Promise<bigint>>()
      .mockRejectedValueOnce(throttledEstimateGasError())
      .mockRejectedValueOnce(throttledEstimateGasError())
      .mockResolvedValue(860207n);

    // 3 attempts keeps the backoff (1s + 2s worst case) inside the test timeout
    await expect(rateLimit.withRateLimitRetry('estimateGas', operation, 3)).resolves.toBe(860207n);
    expect(operation).toHaveBeenCalledTimes(3);
  });

  test('gives up and rethrows once attempts run out', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const operation = jest.fn<() => Promise<bigint>>().mockRejectedValue(throttledEstimateGasError());

    await expect(rateLimit.withRateLimitRetry('estimateGas', operation, 2)).rejects.toThrow('missing revert data');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  test('does not retry errors that are not rate limiting', async () => {
    const operation = jest.fn<() => Promise<bigint>>().mockRejectedValue(new Error('execution reverted'));

    await expect(rateLimit.withRateLimitRetry('estimateGas', operation)).rejects.toThrow('execution reverted');
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
