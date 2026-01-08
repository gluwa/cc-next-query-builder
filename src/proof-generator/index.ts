export * as raw from './raw-generator';
export * as api from './api-generator';

export interface ContinuityProof {
  /** The digest of the block before the continuity chain starts
   * This is the prev_digest of the first block */
  lowerEndpointDigest: string;
  /** Array of merkle roots (digests computed on-chain)
   * Block number for index i = startBlock + i, where startBlock = queryBlockHeight - 1 */
  roots: string[];
}

export class TransactionMerkleProof {
  public root: string;
  public siblings: MerkleProofEntry[];

  constructor(root: string, siblings: MerkleProofEntry[]) {
    this.root = root;
    this.siblings = siblings;
  }
}

export class MerkleProofEntry {
  public hash: string;
  public isLeft: boolean;

  constructor(hash: string, isLeft: boolean) {
    this.hash = hash;
    this.isLeft = isLeft;
  }
}

export interface ContinuityResponse {
  chainKey: number;
  headerNumber: number;
  txIndex: number;
  txHash: string;
  txBytes: string;
  continuityProof: ContinuityProof;
  merkleProof: TransactionMerkleProof;
  cached: boolean;
  generatedAt: Date;
}

export interface ProofGenerationResult {
  success: boolean;
  data?: ContinuityResponse;
  error?: string;
}

export interface ProofGenerator {
  generateProof(transactionHash: string): Promise<ProofGenerationResult>;
}
