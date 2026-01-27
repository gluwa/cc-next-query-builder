import { test, expect } from '@jest/globals';
import { Block, JsonRpcProvider, TransactionReceipt, TransactionResponse } from 'ethers';

import { proofGenerator, chainInfo, blockProver } from '../../src';
import { EncodingVersion, TransactionWithRaw } from '../../src/encoding';

import { keccak256 } from 'ethers';

interface MockTransaction {
  index: number;
  blockNumber: number;
  blockHash: string;
  type: number;
  nonce: number;
  gasLimit: bigint;
  from: string;
  to: string;
  value: bigint;
  data: string;
  chainId: number;
  gasPrice: bigint;
  accessList: any[];
  signature: {
    yParity: number;
    r: string;
    s: string;
  };
}

interface MockTransactionReceipt {
  index: number;
  blockNumber: number;
  blockHash: string;
  status: number;
  gasUsed: bigint;
  logs: MockReceiptLog[];
  logsBloom: string;
}

interface MockReceiptLog {
  address: string;
  topics: string[];
  data: string;
}

interface MockBlock extends Block {
  transactions: string[];
  receipts: TransactionReceipt[];
  prefetchedTransactions: TransactionResponse[];
  getTransaction(indexOrHash: number | string): Promise<TransactionResponse>;
}

class MockBlockProvider implements proofGenerator.raw.blockProvider.BlockProvider {
  private blockNumber: number = 1;

  private transactions: Map<string, TransactionWithRaw> = new Map();
  private blocks: Map<number, { block: Block; receipts: TransactionReceipt[] }> = new Map();

  constructor() {}

  public setBlockNumber(blockNumber: number) {
    this.blockNumber = blockNumber;
  }

  public async getBlockNumber(): Promise<number> {
    return this.blockNumber;
  }

  public async getTransaction(transactionHash: string): Promise<TransactionWithRaw | null> {
    return this.transactions.get(transactionHash) || null;
  }

  public addBlocks(startBlockNumber: number, count: number) {
    for (let i = 0; i <= count; i++) {
      const blockNumber = startBlockNumber + i;
      const blockHash = keccak256(Buffer.from(`block${blockNumber}`));
      const transactionHash = keccak256(Buffer.from(`tx${blockNumber}_0`));
      const transactions: string[] = [transactionHash];
      const receipts: MockTransactionReceipt[] = [
        {
          index: 0,
          blockNumber: blockNumber,
          blockHash: blockHash,
          status: 1,
          gasUsed: BigInt(21000),
          logs: [
            {
              address: keccak256(Buffer.from(`block${blockNumber}_0_log_address`)).slice(0, 42),
              topics: [
                keccak256(Buffer.from(`block${blockNumber}_0_log_topic1`)),
                keccak256(Buffer.from(`block${blockNumber}_0_log_topic2`)),
              ],
              data: keccak256(Buffer.from(`block${blockNumber}_0_log_data`)),
            },
          ],
          logsBloom: keccak256(Buffer.from(`block${blockNumber}_0_logs`)),
        },
      ];

      const transaction: TransactionResponse = {
        index: 0,
        blockNumber: blockNumber,
        blockHash: blockHash,
        type: 1,
        nonce: 0,
        gasLimit: BigInt(21000),
        from: keccak256(Buffer.from(`block${blockNumber}_0_from`)).slice(0, 42),
        to: keccak256(Buffer.from(`block${blockNumber}_0_to`)).slice(0, 42),
        value: BigInt(0),
        data: '0x',
        chainId: 0,
        gasPrice: BigInt(23),
        accessList: [],
        signature: {
          yParity: 0,
          r: '0x' + '00'.repeat(32),
          s: '0x' + '00'.repeat(32),
        },
      } as MockTransaction as unknown as TransactionResponse;
      const raw = { authorizationList: [] };
      const transactionWithRaw = new TransactionWithRaw(transaction, raw);
      this.transactions.set(transactionHash, transactionWithRaw);

      const block: MockBlock = {
        number: blockNumber,
        transactions: transactions,
        receipts: receipts as unknown as TransactionReceipt[],
        prefetchedTransactions: [transaction],
        getTransaction: async (indexOrHash: number | string): Promise<TransactionResponse> => {
          if (typeof indexOrHash === 'number') {
            const txHash = transactions[indexOrHash];
            return this.transactions.get(txHash)!.formatted;
          } else {
            return this.transactions.get(indexOrHash)!.formatted;
          }
        },
      } as MockBlock;

      this.blocks.set(blockNumber, { block, receipts: block.receipts });
    }
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

class MockContinuityProvider implements chainInfo.ChainInfoProvider {
  private upperBound: chainInfo.ContinuityBound | null = null;
  private lowerBound: chainInfo.ContinuityBound | null = null;

  public setUpperBound(blockNumber: number) {
    this.upperBound = {
      blockNumber: blockNumber,
      digest: keccak256(Buffer.from(`continuity_upper_bound_${blockNumber}`)),
    };
  }

  public setLowerBound(blockNumber: number) {
    this.lowerBound = {
      blockNumber: blockNumber,
      digest: keccak256(Buffer.from(`continuity_lower_bound_${blockNumber}`)),
    };
  }

  public async getContinuityBounds(_chainKey: number, _height: number): Promise<chainInfo.ContinuityBounds> {
    return { lowerBound: this.lowerBound, upperBound: this.upperBound };
  }

  public async getSupportedChains(): Promise<chainInfo.ChainInfo[]> {
    throw new Error('Method not implemented.');
  }
  public async getLatestAttestedHeightAndHash(chainKey: number): Promise<chainInfo.HeightHash> {
    throw new Error('Method not implemented.');
  }
  public async getAttestationGenesisHeight(chainKey: number): Promise<number> {
    return 0;
  }

  public async waitUntilHeightAttested(
    _chainKey: number,
    _targetHeight: number,
    _pollIntervalMs: number = 1000,
    _waitTimeoutMs: number = 60000,
  ): Promise<void> {
    return;
  }
}

test('RawProofGenerator: should return proof', async () => {
  // We create a bunch of mock blocks and transactions along with continuity bounds
  // Using those we will be able to generate a proof for a transaction

  const blockProvider = new MockBlockProvider();
  const continuityProvider = new MockContinuityProvider();

  blockProvider.addBlocks(0, 20);
  blockProvider.setBlockNumber(20);

  continuityProvider.setLowerBound(0);
  continuityProvider.setUpperBound(20);

  const block = await blockProvider.getBlockWithReceipts(11);
  const txHash = block.block.transactions[0];

  const generator = new proofGenerator.raw.RawProofGenerator(1, blockProvider, continuityProvider, EncodingVersion.V1);

  const transactionHash = txHash;
  const result = await generator.generateProof(transactionHash);

  // We expect a successful proof generation
  expect(result.success).toBe(true);
  expect(result.error).toBeUndefined();
});

test('RawProofGenerator: should return error for non-existent transaction', async () => {
  const blockProvider = new MockBlockProvider();
  const continuityProvider = new MockContinuityProvider();

  const generator = new proofGenerator.raw.RawProofGenerator(1, blockProvider, continuityProvider, EncodingVersion.V1);

  const transactionHash = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const result = await generator.generateProof(transactionHash);

  // Expect an error since transaction does not exist
  expect(result.success).toBe(false);
  expect(result.error).toBe(`Transaction ${transactionHash} not found`);
});

test('RawProofGenerator: return error if no lower bound', async () => {
  // If no lower bound is found, we cannot build the continuity proof
  // so an error will be returned

  const blockProvider = new MockBlockProvider();
  const continuityProvider = new MockContinuityProvider();

  // We create blocks up to 10 and set current block number to 10
  blockProvider.addBlocks(0, 10);
  blockProvider.setBlockNumber(10);

  // We set only upper bound to 20
  continuityProvider.setUpperBound(20);

  // We try to generate a proof for the first transaction in block 10
  const block = await blockProvider.getBlockWithReceipts(10);
  const txHash = block.block.transactions[0];

  const generator = new proofGenerator.raw.RawProofGenerator(1, blockProvider, continuityProvider, EncodingVersion.V1);

  const transactionHash = txHash;
  const result = await generator.generateProof(transactionHash);

  // Expect an error since lower bound is missing
  expect(result.success).toBe(false);
  expect(result.error).toBe(
    'Failed to build continuity proof: Cannot build continuity proof for height 10 without both lower and upper bounds',
  );
});

test('RawProofGenerator: return error if no upper bound', async () => {
  // If no upper bound is found, we cannot build the continuity proof
  // so an error will be returned

  const blockProvider = new MockBlockProvider();
  const continuityProvider = new MockContinuityProvider();

  // We create blocks up to 10 and set current block number to 10
  blockProvider.addBlocks(0, 10);
  blockProvider.setBlockNumber(10);

  // We set only lower bound to 0
  continuityProvider.setLowerBound(0);

  // We try to generate a proof for the first transaction in block 10
  const block = await blockProvider.getBlockWithReceipts(10);
  const txHash = block.block.transactions[0];

  const generator = new proofGenerator.raw.RawProofGenerator(1, blockProvider, continuityProvider, EncodingVersion.V1);

  const transactionHash = txHash;
  const result = await generator.generateProof(transactionHash);

  // Expect an error since upper bound is missing
  expect(result.success).toBe(false);
  expect(result.error).toBe(
    'Failed to build continuity proof: Cannot build continuity proof for height 10 without both lower and upper bounds',
  );
});

test('RawProofGenerator: return error if upper bound is above current block height', async () => {
  // If latest block number is 10, but upper bound is 20 that means we cannot build the proof
  // since we won't be able to fetch the required blocks to build it, so an error will be returned

  const blockProvider = new MockBlockProvider();
  const continuityProvider = new MockContinuityProvider();

  // We create blocks up to 10 and set current block number to 10
  blockProvider.addBlocks(0, 10);
  blockProvider.setBlockNumber(10);

  // We set lower bound to 0 and upper bound to 20 meaning that we have attestations/checkpoints
  // all the way from block 0 to block 20
  continuityProvider.setLowerBound(0);
  continuityProvider.setUpperBound(20);

  // We try to generate a proof for the first transaction in block 10
  const block = await blockProvider.getBlockWithReceipts(10);
  const txHash = block.block.transactions[0];

  const generator = new proofGenerator.raw.RawProofGenerator(1, blockProvider, continuityProvider, EncodingVersion.V1);

  const transactionHash = txHash;
  const result = await generator.generateProof(transactionHash);

  // Expect an error since upper bound is above latest block number
  expect(result.success).toBe(false);
  expect(result.error).toBe(
    'Failed to build continuity proof: Cannot build continuity proof up to attestation/checkpoint at height 20 greater than latest block number 10',
  );
});

test.skip('E2E ProofGenerator integration test', async () => {
  // Initialize block provider connected to local source ethereum chain
  const sourceChainRpc = 'http://localhost:8545';
  const ethProvider = new JsonRpcProvider(sourceChainRpc);
  const blockProvider = new proofGenerator.raw.blockProvider.SimpleBlockProvider(ethProvider);

  // Continuity provider using precompile contract from local creditcoin chain
  const ccRpc = 'http://localhost:9944';
  const ccProvider = new JsonRpcProvider(ccRpc);
  const chainInfoProvider = new chainInfo.PrecompileChainInfoProvider(ccProvider);

  const chainInfos = await chainInfoProvider.getSupportedChains();
  console.log('Supported chains from continuity provider:', chainInfos);

  const latestHeightHash = await chainInfoProvider.getLatestAttestedHeightAndHash(2);
  console.log('Latest attested height and hash for chain key 2:', latestHeightHash);

  const genesisHeightHash = await chainInfoProvider.getAttestationGenesisHeight(2);
  console.log('Genesis attestation height for chain key 2:', genesisHeightHash);

  // NOTE: Replace with your test chain key
  const chainKey = 2;

  // Initialize BlockProver contract instance from local creditcoin chain
  const prover = new blockProver.PrecompileBlockProver(ccProvider);

  // NOTE: Replace with a valid transaction hash from your local source chain
  const txHash1 = '0x2d83504d496cb9e4a7f801c7a516aa9b6144b73e39e52f8c2934ae20e1e83c74';
  const txBlock1 = await ethProvider.getTransaction(txHash1).then((tx) => tx?.blockNumber);
  const txHash2 = '0x6fe777442b70a5511f3c443176ae860e50445bd93b663711717996a70c5022ab';
  const txBlock2 = await ethProvider.getTransaction(txHash2).then((tx) => tx?.blockNumber);

  console.log(`Transaction 1 is in block ${txBlock1}`);
  console.log(`Transaction 2 is in block ${txBlock2}`);

  // We await the highest block to be attested before generating proofs
  console.log(`Waiting for block ${latestHeightHash.height} to be attestated...`);
  await chainInfoProvider.waitUntilHeightAttested(chainKey, Math.max(txBlock1!, txBlock2!));

  // First we test with the raw proof generator
  const rawProofGenerator = new proofGenerator.raw.RawProofGenerator(
    chainKey,
    blockProvider,
    chainInfoProvider,
    EncodingVersion.V1,
  );
  const rawProofResult = await rawProofGenerator.generateProof(txHash1);
  expect(rawProofResult.success).toBe(true);

  const proofData = rawProofResult.data!;
  const proveResultRaw = await prover.verifySingle(
    proofData.chainKey,
    proofData.headerNumber,
    proofData.txBytes,
    proofData.merkleProof,
    proofData.continuityProof,
    true,
  );
  expect(proveResultRaw).toBe(true);

  // Then we test with the proof generator API server
  const apiServerUrl = 'http://localhost:3100';
  const requestTimeout = 5000; // 5 seconds
  const apiProvider = new proofGenerator.api.ProverAPIProofGenerator(chainKey, apiServerUrl, requestTimeout);
  const apiProofResult_1 = await apiProvider.generateProof(txHash1);
  expect(apiProofResult_1.success).toBe(true);

  const apiProofData_1 = apiProofResult_1.data!;

  const a: [number, proofGenerator.ContinuityProof][] = [apiProofData_1].map((data) => [
    data.headerNumber,
    data.continuityProof,
  ]);

  const proveResultApi_1 = await prover.verifySingle(
    apiProofData_1.chainKey,
    apiProofData_1.headerNumber,
    apiProofData_1.txBytes,
    apiProofData_1.merkleProof,
    apiProofData_1.continuityProof,
    true,
  );
  expect(proveResultApi_1).toBe(true);

  const apiProofResult_2 = await apiProvider.generateProof(txHash2);
  expect(apiProofResult_2.success).toBe(true);
  const apiProofData_2 = apiProofResult_2.data!;

  const numberedProofs: [number, proofGenerator.ContinuityProof][] = [
    [apiProofData_1.headerNumber, apiProofData_1.continuityProof],
    [apiProofData_2.headerNumber, apiProofData_2.continuityProof],
  ];

  const mergedProof = proofGenerator.mergeProofs(numberedProofs);

  console.log(JSON.stringify(mergedProof, null, 2));

  const proveResultApi_2 = await prover.verifyBatch(
    apiProofData_1.chainKey,
    [apiProofData_1.headerNumber, apiProofData_2.headerNumber],
    [apiProofData_1.txBytes, apiProofData_2.txBytes],
    [apiProofData_1.merkleProof, apiProofData_2.merkleProof],
    mergedProof,
    true,
  );
  expect(proveResultApi_2).toBe(true);
}, 120_000);
