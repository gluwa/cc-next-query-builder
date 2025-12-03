import axios, { AxiosInstance } from 'axios';

import { ContinuityResponse, ProofGenerationResult, ProofGenerator } from '..';

const API_BASE_PATH = '/api/v1/proof-by-tx';

class ApiClient {
  private client: AxiosInstance;

  constructor(baseURL: string, timeout: number = 5000) {
    this.client = axios.create({
      baseURL,
      timeout,
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
 * Server is expected to expose an endpoint at `/api/v1/proof-by-tx/{transactionHash}`
 *
 */
export class ProverAPIProofGenerator implements ProofGenerator {
  private client: ApiClient;

  private chainKey: number;

  constructor(chainKey: number, apiServerUrl: string, timeout: number = 5000) {
    this.chainKey = chainKey;
    this.client = new ApiClient(apiServerUrl, timeout);
  }

  public async generateProof(transactionHash: string): Promise<ProofGenerationResult> {
    try {
      const res = await this.client.queryProofFor(this.chainKey, transactionHash);

      return { success: true, data: res };
    } catch (error) {
      return { success: false, error: `Failed to generate proof via API: ${error}` };
    }
  }
}
