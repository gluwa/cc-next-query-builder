export { RawProofGenerator } from './raw-generator';
export { ProverAPIProofGenerator } from './api-generator';

export interface ContinuityBlock {
  merkleRoot: string;
  digest: string;
}

export interface ContinuityProof {
  /** The digest of the block before the continuity chain starts
   * This is the prev_digest of the first block */
  lowerEndpointDigest: string;
  /** Array of continuity blocks (each containing only root and digest)
   * Block numbers are inferred: blocks[i] is at (queryHeight - 1) + i for single query */
  blocks: ContinuityBlock[];
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
  continuityProof: ContinuityProof;
  merkleProof: TransactionMerkleProof;
  merkleRoot: string;
  cached: boolean;
  generatedAt: Date;
}

export type ProofGenerationResult = { success: true; data: ContinuityResponse } | { success: false; error: string };

export interface ProofGenerator {
  generateProof(transactionHash: string): Promise<ProofGenerationResult>;
}
