import { ProofGenerationResult, ProofGenerator } from '..';

import { abiEncode, EncodingVersion } from '../../encodings';

import { ContinuityProofBuilder } from './continuity-proof';
import { KeccakMerkleTree } from './merkle';
import { BlockProvider } from './block-provider';
import { ContinuityProvider } from './continuity-provider';

// Re-export for easier access
export * as blockProvider from './block-provider';
export * as continuityProvider from './continuity-provider';
export { EncodingVersion } from '../../encodings';

/**
 * RawProofGenerator generates raw proofs for a given transaction.
 *
 * It uses both an Ethereum JSON-RPC provider and a Polkadot API provider to fetch necessary data.
 *
 * The generator constructs Merkle proofs for transactions and continuity proofs for blocks.
 */
export class RawProofGenerator implements ProofGenerator {
  private blockProvider: BlockProvider;
  private continuityProvider: ContinuityProvider;

  private chainKey: number;
  private builder: ContinuityProofBuilder;

  constructor(
    chainKey: number,
    blockProvider: BlockProvider,
    continuityProvider: ContinuityProvider,
    encoding: EncodingVersion,
  ) {
    this.blockProvider = blockProvider;
    this.continuityProvider = continuityProvider;

    this.chainKey = chainKey;
    this.builder = new ContinuityProofBuilder(this.blockProvider, this.continuityProvider, chainKey, encoding);
  }

  public async generateProof(transactionHash: string): Promise<ProofGenerationResult> {
    // First we need to create merkle proof for the transaction block
    const tx = await this.blockProvider.getTransaction(transactionHash);
    if (!tx) {
      return { success: false, error: `Transaction ${transactionHash} not found` };
    }

    const txIndex = tx.index;
    const blockNumber = tx.blockNumber;
    const blockHash = tx.blockHash;

    // If transaction is pending, we cannot generate a proof since it's not in a block yet which could be attested
    if (!blockNumber || !blockHash) {
      return { success: false, error: `Transaction ${transactionHash} is pending and not yet included in a block` };
    }

    console.log(`Transaction found in block ${blockNumber}: ${blockHash} at index ${txIndex}`);

    const { block, receipts } = await this.blockProvider.getBlockWithReceipts(blockNumber);
    if (!block) {
      return { success: false, error: `Block ${blockNumber} not found for transaction ${transactionHash}` };
    }
    const orderedReceipts = receipts.sort((a, b) => a.index - b.index);

    // We need the data of all transactions in the block
    // to build the merkle proof of the block
    const transactions = await Promise.all(
      block.transactions.map(async (txHash) => {
        return await block.getTransaction(txHash);
      }) || [],
    );
    const orderedTransactions = transactions.sort((a, b) => a.index - b.index);

    // If for some reason the counts don't match, error out
    if (orderedTransactions.length !== orderedReceipts.length) {
      return {
        success: false,
        error: `Mismatch between transactions and receipts count in block ${blockNumber}`,
      };
    }

    // We can now ABI encode all transactions in the block
    // which will be the leaves of the merkle tree
    const encodedTx = orderedTransactions.map((txData, idx) => {
      const abi = abiEncode(txData, orderedReceipts[idx], EncodingVersion.V1);
      return abi.abi;
    });

    // We can now build the merkle tree and proof
    // for the transaction at txIndex
    const tree = new KeccakMerkleTree(encodedTx);
    const merkleProof = tree.generateProof(txIndex);

    try {
      const continuityProof = await this.builder.createForHeight(blockNumber);

      return {
        success: true,
        data: {
          chainKey: this.chainKey,
          headerNumber: blockNumber,
          txIndex,
          txHash: transactionHash,
          txBytes: encodedTx[txIndex],
          continuityProof,
          merkleProof,
          cached: false,
          generatedAt: new Date(),
        },
      };
    } catch (e) {
      return { success: false, error: `Failed to build continuity proof: ${(e as Error).message}` };
    }
  }
}
