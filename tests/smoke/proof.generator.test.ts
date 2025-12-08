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

  expect(proofResult.success).toBe(false);
  expect(proofResult.error).toBe(
    'Transaction 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 not found',
  );
});

test('E2E ProofGenerator integration test', async () => {
  // Alith private key from Anvil default accounts
  const privateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const anvilRpc = 'http://localhost:8545';
  const ethProvider = new JsonRpcProvider(anvilRpc);
  const blockProvider = new proof.raw.blockProvider.SimpleBlockProvider(ethProvider);

  // Continuity provider using precompile contract
  const ccRpc = 'http://localhost:9944';
  const ccProvider = new JsonRpcProvider(ccRpc);
  const alith = new Wallet(privateKey, ccProvider);
  const continuityProvider = new proof.raw.continuityProvider.PrecompileContinuityProvider(alith);

  // Block prover contract
  const blockProverContractAddress = '0x0000000000000000000000000000000000000FD2';
  const contractABI = BlockProverABI as unknown as InterfaceAbi;
  const blockProverContract = new Contract(blockProverContractAddress, contractABI, alith);

  // NOTE: Replace with your test chain key
  const chainKey = 2;

  // NOTE: Replace with a valid transaction hash from your Anvil instance
  const transactionHash = '0x419f79244ee982c48feda702edd2329cd1c5aa25d849023e031665a82c7053ff';

  // First we test with the raw proof generator
  const rawProofGenerator = new proof.raw.RawProofGenerator(
    chainKey,
    blockProvider,
    continuityProvider,
    EncodingVersion.V1,
  );
  const rawProofResult = await rawProofGenerator.generateProof(transactionHash);
  expect(rawProofResult.success).toBe(true);

  const proofData = rawProofResult.data!;
  const proveResultRaw = await blockProverContract.verify(
    proofData.chainKey,
    proofData.headerNumber,
    proofData.txBytes,
    proofData.merkleProof,
    proofData.continuityProof,
  );
  expect(proveResultRaw).toBe(true);

  const apiProvider = new proof.api.ProverAPIProofGenerator(chainKey, 'http://localhost:3100', 5000);
  const apiProofResult = await apiProvider.generateProof(transactionHash);
  const apiProofData = apiProofResult.data!;

  const proveResultApi = await blockProverContract.verify(
    apiProofData.chainKey,
    apiProofData.headerNumber,
    apiProofData.txBytes,
    apiProofData.merkleProof,
    apiProofData.continuityProof,
  );
  expect(proveResultApi).toBe(true);
});
