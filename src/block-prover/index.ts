import { Contract, ContractMethod, InterfaceAbi, JsonRpcApiProvider } from 'ethers';

import BlockProverABI from './block_prover.json';
import { ContinuityProof, TransactionMerkleProof } from '../proof-generator';

const contractABI = BlockProverABI as unknown as InterfaceAbi;

export interface BlockProvingProvider {
  verifySingle(
    chainKey: number,
    height: number,
    encodedTransaction: string,
    merkleProof: TransactionMerkleProof,
    continuityProof: ContinuityProof,
    emitEvent: boolean,
  ): Promise<boolean>;
  verifyBatch(
    chainKey: number,
    heights: number[],
    encodedTransaction: string[],
    merkleProofs: TransactionMerkleProof[],
    sharedProof: ContinuityProof,
    emitEvent: boolean,
  ): Promise<boolean>;
}

/**
 * Default address for the ChainInfo precompile contract
 */
export const BLOCK_PROVER_PRECOMPILE_ADDRESS = '0x0000000000000000000000000000000000000FD2';

const VERIFY_SINGLE_NO_EVENT = 'verify(uint64,uint64,bytes,(bytes32,(bytes32,bool)[]),(bytes32,bytes32[]))';
const VERIFY_SINGLE_WITH_EVENT = 'verifyAndEmit(uint64,uint64,bytes,(bytes32,(bytes32,bool)[]),(bytes32,bytes32[]))';

const VERIFY_BATCH_NO_EVENT = 'verify(uint64,uint64[],bytes[],(bytes32,(bytes32,bool)[])[],(bytes32,bytes32[]))';
const VERIFY_BATCH_WITH_EVENT =
  'verifyAndEmit(uint64,uint64[],bytes[],(bytes32,(bytes32,bool)[])[],(bytes32,bytes32[]))';

/**
 * Implementation of BlockProvingProvider using a link the precompile contract on creditcoin.
 *
 * The prover allows verifying transaction inclusion and block continuity proofs on-chain.
 *
 * It provides two main methods: `verifySingle` for single transaction proofs and `verifyBatch` for batch proofs.
 * Both additionally support an `emitEvent` flag to trigger event emission upon successful verification.
 *
 */
export class PrecompileBlockProver implements BlockProvingProvider {
  public blockProverContract: Contract;

  /**
   * Creates a new PrecompileBlockProver instance
   * @param rpc - The JSON-RPC API provider for blockchain communication
   * @param blockProverPrecompile - The address of the BlockProver precompile contract (defaults to standard address)
   */
  constructor(rpc: JsonRpcApiProvider, blockProverPrecompile: string = BLOCK_PROVER_PRECOMPILE_ADDRESS) {
    this.blockProverContract = new Contract(blockProverPrecompile, contractABI, rpc);
  }

  /**
   * Verifies a single transaction proof on-chain.
   *
   * @param chainKey - The unique identifier for the source chain on the creditcoin network
   * @param height - The block height of the transaction being verified
   * @param encodedTransaction - The ABI-encoded transaction data using the `abiEncode` function or equivalent.
   * @param merkleProof - The Merkle proof for the transaction inclusion
   * @param continuityProof - The continuity proof for the block
   * @param emitEvent - Whether to emit an event upon successful verification
   * @returns A promise resolving to true if verification succeeds, false otherwise
   * @throws Error if the verification call fails
   *
   * @example
   * ```typescript
   * const chainKey = 2; // Example chain key
   * const apiServerUrl = 'https://proof-gen-api.usc-testnet2.creditcoin.network';
   * const apiProvider = new proof.api.ProverAPIProofGenerator(chainKey, apiServerUrl);
   * const proofResult = await apiProvider.generateProof(transactionHash);
   * expect(proofResult.success).toBe(true);
   *
   * // Proof generation was successful, extract data and verify on-chain
   * const proofData = proofResult.data!;
   * const provingResult = await blockProver.verifySingle(
   *   proofData.chainKey,
   *   proofData.headerNumber,
   *   proofData.txBytes,
   *   proofData.merkleProof,
   *   proofData.continuityProof,
   *   true,
   * );
   * expect(provingResult).toBe(true);
   * ```
   */
  public async verifySingle(
    chainKey: number,
    height: number,
    encodedTransaction: string,
    merkleProof: TransactionMerkleProof,
    continuityProof: ContinuityProof,
    emitEvent: boolean,
  ): Promise<boolean> {
    let method: ContractMethod;
    if (emitEvent) {
      method = this.blockProverContract.getFunction(VERIFY_SINGLE_WITH_EVENT);
    } else {
      method = this.blockProverContract.getFunction(VERIFY_SINGLE_NO_EVENT);
    }

    // Calculate a reasonable estimate based on continuity proof size (matching Rust logic)
    // Base: 21000 (tx) + ~5000 per continuity block + ~10000 for merkle + overhead
    const calculatedGas = 21000 + continuityProof.roots.length * 5000 + 10000 + 10000;

    try {
      return await method.staticCall(chainKey, height, encodedTransaction, merkleProof, continuityProof, {
        gasLimit: calculatedGas,
      });
    } catch (error: any) {
      console.error(`Error trying to verify query: ${error.shortMessage}`);
      throw error;
    }
  }

  /**
   * Verifies a batch of transaction proofs on-chain using a shared continuity proof.
   *
   * @param chainKey - The unique identifier for the source chain on the creditcoin network
   * @param heights - An array of block heights for each transaction being verified
   * @param encodedTransaction - An array of ABI-encoded transaction data using the `abiEncode` function or equivalent.
   * @param merkleProofs - An array of Merkle proofs for each transaction inclusion
   * @param sharedProof - A shared continuity proof for the batch of blocks
   * @param emitEvent - Whether to emit an event upon successful verification
   * @returns A promise resolving to true if all verifications succeed, false otherwise
   * @throws Error if the verification call fails
   * @example
   * ```typescript
   * const chainKey = 2; // Example chain key
   * const apiServerUrl = 'https://proof-gen-api.usc-testnet2.creditcoin.network';
   * const apiProvider = new proof.api.ProverAPIProofGenerator(chainKey, apiServerUrl);
   * const transactionHashes = [
   *   '0xabc123...', // Example transaction hash 1
   *   '0xdef456...', // Example transaction hash 2
   * ];
   * const proofResults = await Promise.all(
   *   transactionHashes.map((txHash) => apiProvider.generateProof(txHash)),
   * );
   * proofResults.forEach((result) => expect(result.success).toBe(true));
   * const proofDatas = proofResults.map((res) => res.data!);
   *
   * // Extract proof data for batch verification
   * const heights = proofDatas.map((data) => data.headerNumber);
   * const encodedTransactions = proofDatas.map((data) => data.txBytes);
   * const merkleProofs = proofDatas.map((data) => data.merkleProof);
   *
   * // We merged together the continuity proofs into a single shared proof
   * const continuityProofs: [number, proof.ContinuityProof][] = proofDatas.map((data) => [data.headerNumber, data.continuityProof]);
   * const mergedProof: ContinuityProof = ContinuityProofBuilder.mergeProofs(continuityProofs);
   *
   * const provingResult = await blockProver.verifyBatch(
   *   chainKey,
   *   heights,
   *   encodedTransactions,
   *   merkleProofs,
   *   mergedProof,
   *   true,
   * );
   * expect(provingResult).toBe(true);
   * ```
   * @returns
   */
  public async verifyBatch(
    chainKey: number,
    heights: number[],
    encodedTransaction: string[],
    merkleProofs: TransactionMerkleProof[],
    sharedProof: ContinuityProof,
    emitEvent: boolean,
  ): Promise<boolean> {
    let method: ContractMethod;
    if (emitEvent) {
      method = this.blockProverContract.getFunction(VERIFY_BATCH_WITH_EVENT);
    } else {
      method = this.blockProverContract.getFunction(VERIFY_BATCH_NO_EVENT);
    }

    // Calculate a reasonable estimate based on continuity proof size (matching Rust logic)
    // Base: 21000 (tx) + ~5000 per continuity block + ~10000 for merkle + overhead
    const calculatedGas = 21000 + sharedProof.roots.length * 5000 + merkleProofs.length * 10000 + 10000;

    try {
      return await method.staticCall(chainKey, heights, encodedTransaction, merkleProofs, sharedProof, {
        gasLimit: calculatedGas,
      });
    } catch (error: any) {
      console.error(`Error trying to verify query: ${error.shortMessage}`);
      throw error;
    }
  }
}
