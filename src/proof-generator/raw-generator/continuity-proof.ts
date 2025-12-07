import { ContinuityBlock, ContinuityProof } from '..';

import { EncodingVersion } from '../../encodings';

import { computeDigestOf, computeMerkleRootOfBlock } from './merkle';
import { BlockProvider } from './block-provider';
import { ContinuityBounds, ContinuityProvider } from './continuity-provider';

export class AttestationBlock {
  public blockNumber: number;
  public root: string;
  public digest: string;
  public prevDigest: string;

  constructor(blockNumber: number, root: string, digest: string, prevDigest: string) {
    this.blockNumber = blockNumber;
    this.root = root;
    this.digest = digest;
    this.prevDigest = prevDigest;
  }
}

export class ContinuityProofBuilder {
  private blockProvider: BlockProvider;
  private attestationProvider: ContinuityProvider;

  private chainKey: number;
  private encoding: EncodingVersion;

  constructor(
    blockProvider: BlockProvider,
    attestationProvider: ContinuityProvider,
    chainKey: number,
    encoding: EncodingVersion,
  ) {
    this.blockProvider = blockProvider;
    this.attestationProvider = attestationProvider;

    this.chainKey = chainKey;
    this.encoding = encoding;
  }

  /**
   * Creates a ContinuityProof from an array of AttestationBlocks.
   *
   * Blocks are expected to be in order from **lowest to highest block number** and to be contiguous.
   * Otherwise, the resulting proof will not be usable for proving.
   *
   * @param blocks Array of AttestationBlocks to convert
   * @returns ContinuityProof object
   */
  public static createFrom(blocks: AttestationBlock[]): ContinuityProof {
    if (blocks.length === 0) {
      return { lowerEndpointDigest: '', blocks: [] };
    }

    // The lowerEndpointDigest is the prev_digest of the first block
    const lowerEndpointDigest = blocks[0].prevDigest;

    // Convert blocks to ContinuityBlocks (dropping blockNumber and prevDigest)
    // prevDigest will be reconstructed from the chain when converting back
    const continuityBlocks: ContinuityBlock[] = blocks.map((b) => ({
      merkleRoot: b.root,
      digest: b.digest,
    }));

    return {
      lowerEndpointDigest,
      blocks: continuityBlocks,
    };
  }

  /**
   * Builds a ContinuityProof for a specific block height.
   *
   * Building the proof requires fetching attestations and checkpoints from the chain,
   * determining the appropriate bounds, and constructing the continuity blocks.
   *
   * Because of this, the method is asynchronous and may take some time to complete.
   *
   * Additionally, the method performs various validations to ensure the proof can be built.
   *
   * If the proof cannot be built (e.g. no attestations exist, bounds cannot be found, etc),
   * **the method will throw an error**.
   *
   * @param queryHeight The block height for which to build the continuity proof
   * @returns A ContinuityProof object representing the proof for the given height
   */
  public async createForHeight(queryHeight: number): Promise<ContinuityProof> {
    // Fetch attestation bounds from the attestation provider
    const bounds = await this.attestationProvider.getContinuityBounds(this.chainKey, queryHeight);
    if (!bounds.lowerBound || !bounds.upperBound) {
      throw new Error(`Cannot build continuity proof for height ${queryHeight} without both lower and upper bounds`);
    }
    console.log(
      `Found attestation bounds for height ${queryHeight}: lower=${bounds.lowerBound.blockNumber}, upper=${bounds.upperBound.blockNumber}`,
    );

    // Using those bounds build the continuity blocks
    const blocks: AttestationBlock[] = await this.buildAndTrimContinuityFor(queryHeight, bounds);
    console.log(`Built ${blocks.length} continuity blocks for height ${queryHeight}`);
    // Finally convert to ContinuityProof
    return ContinuityProofBuilder.createFrom(blocks);
  }

  private async buildAndTrimContinuityFor(queryHeight: number, bounds: ContinuityBounds): Promise<AttestationBlock[]> {
    const requiredStartHeight = queryHeight === 1 ? 0 : queryHeight - 1;

    const lowerBound = bounds.lowerBound!;
    const upperBound = bounds.upperBound!;

    const lastestBlockNumber = await this.blockProvider.getBlockNumber();

    if (lastestBlockNumber < queryHeight) {
      throw new Error(`Latest block number ${lastestBlockNumber} is less than query height ${queryHeight}`);
    }

    // Validate that upper bound is a reasonable height
    if (upperBound.blockNumber > lastestBlockNumber + 1000) {
      throw new Error(
        `Invalid checkpoint block number ${upperBound.blockNumber} greater than latest block number ${lastestBlockNumber}`,
      );
    }

    // If upper bound is beyond latest block number, we cannot build the proof
    if (upperBound.blockNumber > lastestBlockNumber) {
      throw new Error(
        `Cannot build continuity proof up to attestation/checkpoint at height ${upperBound.blockNumber} greater than latest block number ${lastestBlockNumber}`,
      );
    }

    // Use upper bound as end height
    const endHeight = upperBound.blockNumber;

    // Build from attestation/checkpoint lower bound + 1 up to endHeight
    const buildStartHeight = lowerBound.blockNumber + 1;

    // Query and build continuity blocks
    const blocks = await this.createContinuityBlocks(buildStartHeight, endHeight, lowerBound.digest);

    // Trim blocks to start from requiredStartHeight
    const filteredBlocks = blocks.filter((b) => b.blockNumber >= requiredStartHeight);

    return filteredBlocks;
  }

  private async createContinuityBlocks(
    buildStartHeight: number,
    endHeight: number,
    lowerDigest: string,
  ): Promise<AttestationBlock[]> {
    const blockCount = endHeight - buildStartHeight + 1;

    if (blockCount < 1) {
      throw new Error('No blocks to build continuity proof for');
    }

    const blockNumbers = Array.from({ length: blockCount }, (_, i) => buildStartHeight + i);

    // First we need to get the block and receipts for the transaction blocks
    const blocksWithReceipt = await Promise.all(
      blockNumbers.map(async (bn) => {
        return await this.blockProvider.getBlockWithReceipts(bn);
      }) || [],
    );

    // Ensure blocks are ordered by block number
    const orderedBlocksWithReceipt = blocksWithReceipt.sort((a, b) => a.block.number - b.block.number);

    let prevDigest = lowerDigest;
    // Now we need to get the continuity proof for the blocks
    const continuityBlocks = orderedBlocksWithReceipt.map(({ block, receipts }) => {
      const orderedReceipts = receipts.sort((a, b) => a.index - b.index);
      const merkleRoot = computeMerkleRootOfBlock(block, orderedReceipts, this.encoding);
      const digest = computeDigestOf(block.number, merkleRoot, prevDigest);
      const continuityBlock = new AttestationBlock(block.number, merkleRoot, digest, prevDigest);

      prevDigest = digest;

      return continuityBlock;
    });

    return continuityBlocks;
  }
}
