import { ProofGenerationResult, ProofGenerator } from '..';

export class ProverAPIProofGenerator implements ProofGenerator {
  private apiServerUrl: string;

  constructor(apiServerUrl: string) {
    this.apiServerUrl = apiServerUrl;
  }

  async generateProof(transactionHash: string): Promise<ProofGenerationResult> {
    // Implementation goes here
    return { success: false, error: 'Not implemented' };
  }
}
