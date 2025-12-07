import { test, expect } from '@jest/globals';
import {
  Block,
  JsonRpcProvider,
  Contract,
  Wallet,
  InterfaceAbi,
  TransactionReceipt,
  TransactionResponse,
} from 'ethers';

import * as proof from '../../src/proof-generator';
import { EncodingVersion } from '../../src/encodings';

import BlockProverABI from '../abis/block_prover.json';

interface MockTransaction extends TransactionResponse {
  index: number;
  blockNumber: number;
  blockHash: string;
}

interface MockBlock extends Block {
  transactions: string[];
  receipts: TransactionReceipt[];
  getTransaction(indexOrHash: number | string): Promise<TransactionResponse>;
}

class MockBlockProvider implements proof.raw.blockProvider.BlockProvider {
  private blockNumber: number = 0;

  private transactions: Map<string, TransactionResponse> = new Map();
  private blocks: Map<number, { block: Block; receipts: TransactionReceipt[] }> = new Map();

  constructor(blockNumber: number) {
    this.blockNumber = blockNumber;
  }

  public setBlockNumber(blockNumber: number) {
    this.blockNumber = blockNumber;
  }

  public async getBlockNumber(): Promise<number> {
    return this.blockNumber;
  }

  public addTransaction(txHash: string, transaction: MockTransaction) {
    this.transactions.set(txHash, transaction as TransactionResponse);
  }

  public async getTransaction(transactionHash: string): Promise<TransactionResponse | null> {
    return this.transactions.get(transactionHash) || null;
  }

  public addBlockWithReceipts(blockNumber: number, block: MockBlock) {
    this.blocks.set(blockNumber, { block, receipts: block.receipts });
  }

  public async getBlockWithReceipts(blockNumber: number): Promise<{ block: Block; receipts: TransactionReceipt[] }> {
    const data = this.blocks.get(blockNumber);
    if (!data) {
      throw new Error(`Block ${blockNumber} not found`);
    }
    return data;
  }
}

class MockContinuityProvider implements proof.raw.continuityProvider.ContinuityProvider {
  public async getContinuityBounds(
    chainKey: number,
    height: number,
  ): Promise<proof.raw.continuityProvider.ContinuityBounds> {
    return { lowerBound: null, upperBound: null };
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

interface FragmentBlock {
  blockNumber: number;
  root: string;
  prevDigest: string;
  digest: string;
}

interface AttestorCheckpoint {
  blockNumber: number;
  digest: string;
}

test('ProofGenerator works with mock block provider', async () => {
  const blockProvider = new MockBlockProvider(100);
  const continuityProvider = new MockContinuityProvider();

  const gen = new proof.raw.RawProofGenerator(1, blockProvider, continuityProvider, EncodingVersion.V1);

  const proofResult = await gen.generateProof('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');

  console.log(proofResult);
});

test.skip('E2E ProofGenerator integration test', async () => {
  // Alith private key from Anvil default accounts
  const privateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const anvilRpc = 'http://localhost:8545';
  const ethProvider = new JsonRpcProvider(anvilRpc);
  const blockProvider = new proof.raw.blockProvider.SimpleBlockProvider(ethProvider);

  const ccRpc = 'http://localhost:9944';
  const ccProvider = new JsonRpcProvider(ccRpc);
  const alith = new Wallet(privateKey, ccProvider);
  const continuityProvider = new proof.raw.continuityProvider.PrecompileContinuityProvider(alith);

  // Replace with your test chain key
  const chainKey = 2;

  const proofGenerator = new proof.raw.RawProofGenerator(
    chainKey,
    blockProvider,
    continuityProvider,
    EncodingVersion.V1,
  );

  // Replace with a valid transaction hash from your Anvil instance
  const transactionHash = '0x4368272fe05db391947648005962f7acb2e57800c427e309b6d439d90beb7db8';
  const proofResult = await proofGenerator.generateProof(transactionHash);

  if (!proofResult.success) {
    console.error('Proof generation failed:', proofResult.error);
    return;
  }

  const blockProverContractAddress = '0x0000000000000000000000000000000000000FD2';
  const contractABI = BlockProverABI as unknown as InterfaceAbi;
  const blockContract = new Contract(blockProverContractAddress, contractABI, alith);

  const proofData = proofResult.data!;

  console.log(proofData.continuityProof);

  const proveResult = await blockContract.verify(
    proofData.chainKey,
    proofData.headerNumber,
    proofData.txBytes,
    proofData.merkleProof,
    proofData.continuityProof,
  );

  console.log('Proving results:', proveResult);
});
