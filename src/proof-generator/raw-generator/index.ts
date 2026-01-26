import { ProofGenerationResult, ProofGenerator } from '..';
import { ChainInfoProvider } from '../../chain-info';

import { abiEncode, EncodingVersion } from '../../encoding';

import { ContinuityProofBuilder } from './continuity-proof';
import { KeccakMerkleTree } from './merkle';
import { BlockProvider } from './block-provider';

// Re-export for easier access
export * as blockProvider from './block-provider';
export { EncodingVersion } from '../../encoding';

/**
 * RawProofGenerator generates raw proofs for a given transaction.
 *
 * It uses a BlockProvider to fetch block and transaction data from the source chain. And a ChainInfoProvider
 * to get chain-specific information needed for proof generation from the attestation chain.
 *
 * The generator constructs Merkle proofs for transactions and continuity proofs for blocks.
 */
export class RawProofGenerator implements ProofGenerator {
  private blockProvider: BlockProvider;
  private chainInfoProvider: ChainInfoProvider;

  private chainKey: number;
  private builder: ContinuityProofBuilder;

  constructor(
    chainKey: number,
    blockProvider: BlockProvider,
    chainInfoProvider: ChainInfoProvider,
    encoding: EncodingVersion,
  ) {
    this.blockProvider = blockProvider;
    this.chainInfoProvider = chainInfoProvider;
    this.chainKey = chainKey;
    this.builder = new ContinuityProofBuilder(this.blockProvider, this.chainInfoProvider, chainKey, encoding);
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
      // ABI encoded transaction + receipt
      const encoded = abiEncode(txData, orderedReceipts[idx], EncodingVersion.V1);

      return encoded.abi;
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
          txIndex: txIndex,
          txHash: transactionHash,
          txBytes: encodedTx[txIndex],
          continuityProof: continuityProof,
          merkleProof: merkleProof,
          cached: false,
          generatedAt: new Date(),
        },
      };
    } catch (e) {
      return { success: false, error: `Failed to build continuity proof: ${(e as Error).message}` };
    }
  }
}
