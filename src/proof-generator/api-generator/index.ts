import axios, { AxiosInstance } from 'axios';

import { ContinuityResponse, ProofGenerationResult, ProofGenerator } from '..';

const API_BASE_PATH = '/api/v1/proof-by-tx';

class ApiClient {
  private client: AxiosInstance;

  constructor(baseURL: string, timeoutMs: number = 5000) {
    this.client = axios.create({
      baseURL,
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  async queryProofFor(chainKey: number, transactionHash: string): Promise<ContinuityResponse> {
    try {
      const res = await this.client.get(`${API_BASE_PATH}/${chainKey}/${transactionHash}`);

      return res.data as ContinuityResponse;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Failed to fetch proof: ${error}`);
      } else {
        throw new Error(`Unexpected error: ${error}`);
      }
    }
  }
}

/**
 * Proof generator that fetches proofs from a remote API.
 *
 * It uses an HTTP client to communicate with the API server.
 *
 * Timeout can be configured for the HTTP requests.
 *
 * Server is expected to expose an endpoint at `/api/v1/proof-by-tx/{chainKey}/{transactionHash}`
 *
 */
export class ProverAPIProofGenerator implements ProofGenerator {
  private client: ApiClient;

  private chainKey: number;

  constructor(chainKey: number, apiServerUrl: string, timeout: number = 5000) {
    this.chainKey = chainKey;
    this.client = new ApiClient(apiServerUrl, timeout);
  }

  /**
   * Generates a proof for the given transaction hash by querying the remote proof API server.
   *
   * Transaction hash should be provided as a hex string, and should exists in the source chain for which the
   * chainKey was specified during the generator construction.
   *
   * @param transactionHash - The hash of the transaction to generate a proof for, as a hex string.
   * @returns A promise that resolves to the result of the proof generation
   */
  public async generateProof(transactionHash: string): Promise<ProofGenerationResult> {
    try {
      const continuityProof = await this.client.queryProofFor(this.chainKey, transactionHash);

      return { success: true, data: continuityProof };
    } catch (error) {
      return { success: false, error: `Failed to generate proof via API: ${error}` };
    }
  }
}
