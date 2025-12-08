import axios, { AxiosInstance } from 'axios';

import { ContinuityResponse, ProofGenerationResult, ProofGenerator } from '..';

const API_BASE_PATH = '/api/v1/proof-by-tx';

interface ApiMerkleProofEntry {
  hash: string;
  is_left: boolean;
}

interface ApiTransactionMerkleProof {
  root: string;
  siblings: ApiMerkleProofEntry[];
}

interface ApiContinuityBlock {
  merkle_root: string;
  digest: string;
}

interface ApiContinuityProof {
  lower_endpoint_digest: string;
  blocks: ApiContinuityBlock[];
}

interface ApiContinuityResponse {
  chain_key: number;
  header_number: number;
  tx_index: number;
  tx_hash: string;
  tx_bytes: string;
  continuity_proof: ApiContinuityProof;
  merkle_proof: ApiTransactionMerkleProof;
  cached: boolean;
  generated_at: Date;
}

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

  async queryProofFor(chainKey: number, transactionHash: string): Promise<ApiContinuityResponse> {
    try {
      const res = await this.client.get(`${API_BASE_PATH}/${chainKey}/${transactionHash}`);

      return res.data as ApiContinuityResponse;
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

      // Convert API response to ContinuityResponse
      const continuityProof: ContinuityResponse = {
        chainKey: res.chain_key,
        headerNumber: res.header_number,
        txIndex: res.tx_index,
        txHash: res.tx_hash,
        txBytes: res.tx_bytes,
        continuityProof: {
          lowerEndpointDigest: res.continuity_proof.lower_endpoint_digest,
          blocks: res.continuity_proof.blocks.map((block) => ({
            merkleRoot: block.merkle_root,
            digest: block.digest,
          })),
        },
        merkleProof: {
          root: res.merkle_proof.root,
          siblings: res.merkle_proof.siblings.map((entry) => ({
            hash: entry.hash,
            isLeft: entry.is_left,
          })),
        },
        cached: res.cached,
        generatedAt: new Date(res.generated_at),
      };

      return { success: true, data: continuityProof };
    } catch (error) {
      return { success: false, error: `Failed to generate proof via API: ${error}` };
    }
  }
}
