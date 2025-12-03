import { ApiPromise } from '@polkadot/api';
import { JsonRpcProvider } from 'ethers';

import { ContinuityBlock, ContinuityProof } from '..';

import { computeDigestOf, computeMerkleRootOfBlock } from './merkle';
import { getBlockAndReceiptsWithCache } from './block-cache';
import { EncodingVersion } from '../../encodings';

class AttestationBlock {
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

interface SignedAttestation {
  attestation: AttestationRecord;
  signature: string;
  attestors: string[];
  continuityProof: AttestationFragment;
}

interface AttestationRecord {
  chainKey: number;
  headerNumber: number;
  headerHash: string;
  root: string;
  prevDigest: string | null;
}

interface AttestationFragment {
  blocks: any[];
}

interface AttestorCheckpoint {
  blockNumber: number;
  digest: string;
}

interface ContinuityBound {
  blockNumber: number;
  digest: string;
}

interface ContinuityBounds {
  lowerBound: ContinuityBound;
  upperBound: ContinuityBound | null;
  queryHeightAtAttestation: boolean;
  queryHeightAtCheckpoint: boolean;
}

export class ContinuityProofBuilder {
  private ethProvider: JsonRpcProvider;
  private ccProvider: ApiPromise;

  private chainKey: number;
  private encoding: EncodingVersion;

  constructor(provider: JsonRpcProvider, ccProvider: ApiPromise, chainKey: number, encoding: EncodingVersion) {
    this.ethProvider = provider;
    this.ccProvider = ccProvider;
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
    // Fetch attestations from the chain for the given chainKey
    const attestations = await this.fetchAttestations();
    console.log(`Fetched ${attestations.length} attestations for chainKey ${this.chainKey}`);
    // Fetch checkpoints from the chain for the given chainKey
    const checkpoints = await this.fetchCheckpoints();
    console.log(`Fetched ${checkpoints.length} checkpoints for chainKey ${this.chainKey}`);
    // Compute the attestation bounds for the query height
    const bounds = await this.findCountinuityBoundsFor(queryHeight, attestations, checkpoints);

    const lowerBound = bounds.lowerBound.blockNumber;
    const upperBound = bounds.upperBound ? bounds.upperBound.blockNumber : 'null';
    console.log(`Computed attestation bounds for height ${queryHeight}: lower=${lowerBound}, upper=${upperBound}`);

    // Using those bounds build the continuity blocks
    const blocks: AttestationBlock[] = await this.buildAndTrimContinuityFor(queryHeight, bounds);
    console.log(`Built ${blocks.length} continuity blocks for height ${queryHeight}`);
    // Finally convert to ContinuityProof
    return ContinuityProofBuilder.createFrom(blocks);
  }

  private async fetchAttestations(): Promise<AttestationRecord[]> {
    const result = await this.ccProvider.query.attestation.attestations.entries(this.chainKey);

    if (result.length === 0) {
      throw new Error(`No attestations found for chainKey ${this.chainKey}`);
    }

    const attestations: AttestationRecord[] = result.map(([_key, attestation]) => {
      // Raw JSON conversion, should be improved later
      const attestationObj = attestation.toJSON() as any as SignedAttestation;
      return attestationObj.attestation;
    });

    return attestations;
  }

  private async fetchCheckpoints(): Promise<AttestorCheckpoint[]> {
    const checkpoints = (await this.ccProvider.query.attestation.checkpoints.entries(2)).map(([key, checkpoint]) => {
      // Block number is the second argument in the storage key tuple
      const blockNumber = key.args[1].toPrimitive() as number;
      // Digest is the value stored
      const digest = checkpoint.toPrimitive() as any as string;

      return {
        blockNumber,
        digest,
      };
    });

    return checkpoints;
  }

  private async checkIfAtCheckpointHeight(queryHeight: number): Promise<boolean> {
    const response = (await this.ccProvider.query.attestation.lastCheckpoint(this.chainKey)).toPrimitive();

    // If null, no checkpoint exists
    if (response === null) {
      return false;
    }

    // If checkpoint block number matches queryHeight, we are at checkpoint
    const checkpoint = response as any as AttestorCheckpoint;
    if (checkpoint.blockNumber === queryHeight) {
      return true;
    }

    return false;
  }

  private async findCountinuityBoundsFor(
    queryHeight: number,
    attestations: AttestationRecord[],
    checkpoints: AttestorCheckpoint[],
  ): Promise<ContinuityBounds> {
    // First we check if there is an attestation at the query height
    const attestationAtQueryHeight = attestations.find((att) => {
      return att.headerNumber === queryHeight;
    });
    console.log(`Is query height ${queryHeight} at attestation? ${!attestationAtQueryHeight}`);

    const isQueryHeightAtCheckpoint = await this.checkIfAtCheckpointHeight(queryHeight);
    console.log(`Is query height ${queryHeight} at checkpoint? ${isQueryHeightAtCheckpoint}`);

    // In order to build the continuity proof, we need to find the lower bound attestation or checkpoint
    // The lower bound will be the highest attestation/checkpoint below (queryHeight - 1)
    const requiredHeightBefore = queryHeight > 1 ? queryHeight - 1 : 0;

    // We first try to find the lower bound using the attestations and checkpoints
    const lowerBound = this.findLowerBound(requiredHeightBefore, attestations, checkpoints, isQueryHeightAtCheckpoint);

    // Then we try to find the upper bound using the attestation at query height or next attestation/checkpoint
    const upperBound = this.findUpperBound(
      queryHeight,
      attestations,
      checkpoints,
      attestationAtQueryHeight,
      isQueryHeightAtCheckpoint,
    );

    return {
      lowerBound,
      upperBound,
      queryHeightAtAttestation: !attestationAtQueryHeight,
      queryHeightAtCheckpoint: isQueryHeightAtCheckpoint,
    };
  }

  private findLowerBound(
    height: number,
    attestations: AttestationRecord[],
    checkpoints: AttestorCheckpoint[],
    isQueryHeightAtCheckpoint: boolean,
  ): ContinuityBound {
    // First we try to find the attestation at the lower bound
    const attestation = this.findLowerBoundAttestation(height, attestations);

    // If height is at checkpoint or there is no attestation, we try to find checkpoint lower bound
    const checkpoint =
      isQueryHeightAtCheckpoint || !attestation ? this.findLowerBoundCheckpoint(height, checkpoints) : null;

    // If neither attestation nor checkpoint at the lower bound were found, we cannot build the proof
    if (!attestation && !checkpoint) {
      throw new Error(`No attestation or checkpoint found below height ${height}`);
    }

    // Now we need to determine which of the two (attestation or checkpoint) is the actual lower bound
    let bound: ContinuityBound | null = null;

    // First we assign the value from attestation if it exists
    if (attestation) {
      bound = {
        blockNumber: attestation.headerNumber,
        digest: computeDigestOf(attestation.headerNumber, attestation.root, attestation.prevDigest),
      };
    }

    // If we have a checkpoint, we compare it with the our current bound and take the higher one
    if (checkpoint && (!bound || checkpoint.blockNumber > bound.blockNumber)) {
      bound = {
        blockNumber: checkpoint.blockNumber,
        digest: checkpoint.digest,
      };
    }

    // Bound will be non-null here because at least one of attestation or checkpoint will exist by this point
    return bound!;
  }

  private findLowerBoundAttestation(height: number, attestations: AttestationRecord[]): AttestationRecord | null {
    // Filter attestations below the requiredHeight
    const attestationsBelow = attestations.filter((a) => a.headerNumber < height);
    // If no attestation was found below, return null, otherwise return the one with the highest headerNumber
    if (attestationsBelow.length > 0) {
      const attestation = attestationsBelow.reduce((max, current) =>
        current.headerNumber > max.headerNumber ? current : max,
      );

      console.log(`Attestation lower bound: ${attestation.headerNumber}`);

      return attestation;
    } else {
      return null;
    }
  }

  private findLowerBoundCheckpoint(height: number, checkpoints: AttestorCheckpoint[]): AttestorCheckpoint | null {
    const checkpointsBelow = checkpoints.filter((c) => c.blockNumber < height);

    // If there are checkpoints below, find the one with the highest blockNumber
    if (checkpointsBelow.length > 0) {
      const checkpoint = checkpointsBelow.reduce((max, current) =>
        current.blockNumber > max.blockNumber ? current : max,
      );

      console.log(`Checkpoint lower bound: ${checkpoint.blockNumber}`);

      return checkpoint;
    } else {
      return null;
    }
  }

  private findUpperBound(
    height: number,
    attestations: AttestationRecord[],
    checkpoints: AttestorCheckpoint[],
    attestationAtQueryHeight: AttestationRecord | undefined | null,
    isQueryHeightAtCheckpoint: boolean,
  ): ContinuityBound | null {
    // Now we try to build the upper bound info
    let upperBound: ContinuityBound | null = null;

    if (attestationAtQueryHeight) {
      // Query height matches an attestation, use it as upper bound
      upperBound = {
        blockNumber: attestationAtQueryHeight.headerNumber,
        digest: computeDigestOf(
          attestationAtQueryHeight.headerNumber,
          attestationAtQueryHeight.root,
          attestationAtQueryHeight.prevDigest,
        ),
      };
    } else if (isQueryHeightAtCheckpoint) {
      // Query height matches a checkpoint, use it as upper bound
      const checkpointAt = checkpoints.find((c) => c.blockNumber === height)!;
      upperBound = {
        blockNumber: checkpointAt.blockNumber,
        digest: checkpointAt.digest,
      };
    } else {
      // Query is not at an attestation or checkpoint, find the next attestation and/or checkpoint above height
      const attestation = this.findUpperBoundAttestation(height, attestations);

      let checkpoint = null;
      if (!attestation) {
        // No attestation found above height, try to find checkpoint instead
        checkpoint = this.findUpperBoundCheckpoint(height, checkpoints);
      } else {
        // Attestation found, any checkpoint that could exists is going to be
        upperBound = {
          blockNumber: attestation.headerNumber,
          digest: computeDigestOf(attestation.headerNumber, attestation.root, attestation.prevDigest),
        };
      }

      // If we found a checkpoint, compare it with current upper bound and take the lower one
      if (checkpoint && (!upperBound || checkpoint.blockNumber < upperBound.blockNumber)) {
        upperBound = {
          blockNumber: checkpoint.blockNumber,
          digest: checkpoint.digest,
        };
      }
    }

    if (upperBound) {
      console.log(`Continuity upper bound: ${upperBound.blockNumber}`);
    } else {
      console.log(`No continuity upper bound found`);
    }

    return upperBound;
  }

  private findUpperBoundAttestation(height: number, attestations: AttestationRecord[]): AttestationRecord | null {
    // Query is not at an attestation or checkpoint, find the next attestation or checkpoint above queryHeight
    const attestationsAboveQuery = attestations.filter((att) => att.headerNumber > height);

    if (attestationsAboveQuery.length > 0) {
      const attestation = attestationsAboveQuery.reduce((min, current) =>
        current.headerNumber < min.headerNumber ? current : min,
      );

      console.log(`Attestation upper bound: ${attestation.headerNumber}`);

      return attestation;
    } else {
      return null;
    }
  }

  private findUpperBoundCheckpoint(height: number, checkpoints: AttestorCheckpoint[]): AttestorCheckpoint | null {
    const checkpointAboveQuery = checkpoints.filter((c) => c.blockNumber > height);
    if (checkpointAboveQuery.length > 0) {
      const checkpoint = checkpointAboveQuery.reduce((min, current) =>
        current.blockNumber < min.blockNumber ? current : min,
      );

      console.log(`Checkpoint upper bound: ${checkpoint.blockNumber}`);

      return checkpoint;
    } else {
      return null;
    }
  }

  private async buildAndTrimContinuityFor(queryHeight: number, bounds: ContinuityBounds): Promise<AttestationBlock[]> {
    const requiredStartHeight = queryHeight === 1 ? 0 : queryHeight - 1;

    const lowerBound = bounds.lowerBound;
    const upperBound = bounds.upperBound;
    const queryAtAttestation = bounds.queryHeightAtAttestation;
    const queryAtCheckpoint = bounds.queryHeightAtCheckpoint;

    const lastestBlockNumber = await this.ethProvider.getBlockNumber();

    if (lastestBlockNumber < queryHeight) {
      throw new Error(`Latest block number ${lastestBlockNumber} is less than query height ${queryHeight}`);
    }

    // First we calculate the end height for the continuity proof
    let endHeight = null;

    if (upperBound !== null) {
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
      endHeight = upperBound.blockNumber;
    } else {
      // No upper bound attestation/checkpoint found
      // We try to use the query height if at attestation/checkpoint
      if (queryAtAttestation || queryAtCheckpoint) {
        endHeight = queryHeight;
      } else {
        throw new Error(
          `Cannot build continuity proof for height ${queryHeight} without an upper bound attestation or checkpoint`,
        );
      }
    }

    // Build from attestation/checkpoint lower bound + 1 up to endHeight
    const buildStartHeight = lowerBound.blockNumber + 1;

    // Query and build continuity blocks
    const blocks = await this.createContinuityBlocks(buildStartHeight, endHeight, lowerBound.digest);

    // Trim blocks to start from requiredStartHeight
    blocks.filter((b) => b.blockNumber >= requiredStartHeight);

    return blocks;
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
        return await getBlockAndReceiptsWithCache(this.ethProvider, bn);
      }) || [],
    );

    // Ensure blocks are ordered by block number
    const orderedBlocksWithReceipt = blocksWithReceipt.sort((a, b) => a.block.number - b.block.number);

    let prevDigest = lowerDigest;
    // Now we need to get the continuity proof for the blocks
    const continuityBlocks = orderedBlocksWithReceipt.map(({ block, receipts }) => {
      const merkleRoot = computeMerkleRootOfBlock(block, receipts, this.encoding);
      const digest = computeDigestOf(block.number, merkleRoot, prevDigest);
      const continuityBlock = new AttestationBlock(block.number, merkleRoot, digest, prevDigest);

      prevDigest = digest;

      return continuityBlock;
    });

    return continuityBlocks;
  }
}
