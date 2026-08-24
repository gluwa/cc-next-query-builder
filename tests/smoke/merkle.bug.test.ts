import { test, expect } from '@jest/globals';
import { Block, TransactionReceipt, TransactionResponse } from 'ethers';

import { KeccakMerkleTree, computeMerkleRootOfBlock } from '../../src/proof-generator/raw-generator/merkle';
import { EncodingVersion } from '../../src/encodings';

/**
 * This test demonstrates the CRITICAL BUG where computeMerkleRootOfBlock and KeccakMerkleTree
 * produce DIFFERENT merkle roots for the same set of transactions when there's an odd number.
 *
 * The bug is:
 * - computeMerkleRootOfBlock uses ZERO_LEAF for padding odd nodes
 * - KeccakMerkleTree uses ZERO_HASH for padding odd nodes
 *
 * Since ZERO_LEAF ≠ ZERO_HASH, they produce different roots, causing proof verification to fail.
 */

/**
 * Helper to create a mock transaction
 */
function createMockTransaction(blockNumber: number, index: number): TransactionResponse {
  return {
    index: index,
    blockNumber: blockNumber,
    blockHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    hash: `0x${index.toString().padStart(64, '0')}`,
    type: 2,
    nonce: index,
    gasLimit: BigInt(21000),
    from: '0x1111111111111111111111111111111111111111',
    to: '0x2222222222222222222222222222222222222222',
    value: BigInt(0),
    data: '0x',
    chainId: 1,
    gasPrice: BigInt(1000000000),
    maxPriorityFeePerGas: BigInt(1000000000),
    maxFeePerGas: BigInt(2000000000),
    accessList: [],
    signature: {
      r: '0x' + '11'.repeat(32),
      s: '0x' + '22'.repeat(32),
      v: 27,
      networkV: null,
      yParity: 0,
    },
  } as unknown as TransactionResponse;
}

/**
 * Helper to create a mock receipt
 */
function createMockReceipt(blockNumber: number, index: number): TransactionReceipt {
  return {
    index: index,
    blockNumber: blockNumber,
    blockHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    hash: `0x${index.toString().padStart(64, '0')}`,
    status: 1,
    gasUsed: BigInt(21000),
    cumulativeGasUsed: BigInt(21000 * (index + 1)),
    logs: [],
    logsBloom: '0x' + '00'.repeat(256),
    type: 2,
    from: '0x1111111111111111111111111111111111111111',
    to: '0x2222222222222222222222222222222222222222',
    contractAddress: null,
    gasPrice: BigInt(1000000000),
  } as unknown as TransactionReceipt;
}

/**
 * Helper to create a mock block with prefetched transactions
 */
function createMockBlock(blockNumber: number, txCount: number): Block {
  const transactions: TransactionResponse[] = [];
  const txHashes: string[] = [];

  for (let i = 0; i < txCount; i++) {
    const tx = createMockTransaction(blockNumber, i);
    transactions.push(tx);
    txHashes.push(tx.hash);
  }

  return {
    number: blockNumber,
    hash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    transactions: txHashes,
    prefetchedTransactions: transactions,
    timestamp: 1234567890,
    parentHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    nonce: '0x0000000000000000',
    difficulty: BigInt(0),
    gasLimit: BigInt(30000000),
    gasUsed: BigInt(21000 * txCount),
    miner: '0x0000000000000000000000000000000000000000',
    extraData: '0x',
  } as unknown as Block;
}

test('BUG: computeMerkleRootOfBlock and KeccakMerkleTree produce DIFFERENT roots for 3 transactions', async () => {
  // Create a block with 3 transactions (odd number)
  const blockNumber = 100;
  const block = createMockBlock(blockNumber, 3);
  const receipts = [
    createMockReceipt(blockNumber, 0),
    createMockReceipt(blockNumber, 1),
    createMockReceipt(blockNumber, 2),
  ];

  // Method 1: Compute merkle root using computeMerkleRootOfBlock
  // This is used in continuity proof generation
  const rootFromComputeFunction = computeMerkleRootOfBlock(block, receipts, EncodingVersion.V1);

  // Method 2: Compute merkle root using KeccakMerkleTree
  // This is used in merkle proof generation
  // We need to encode transactions the same way as in the RawProofGenerator
  const { solidityPacked } = require('ethers');
  const { abiEncode } = require('../../src/encodings');

  const encodedTx = block.prefetchedTransactions.map((txData, idx) => {
    const abi = abiEncode(txData, receipts[idx], EncodingVersion.V1);
    const encodedData = solidityPacked(['uint64', 'uint64', 'bytes'], [blockNumber, txData.index, abi.abi]);
    return encodedData;
  });

  const tree = new KeccakMerkleTree(encodedTx);
  const rootFromKeccakTree = tree.getRoot();

  // Print the roots for visibility
  console.log('\n=== MERKLE ROOT COMPARISON ===');
  console.log('Block has 3 transactions (ODD NUMBER)');
  console.log('Root from computeMerkleRootOfBlock:', rootFromComputeFunction);
  console.log('Root from KeccakMerkleTree:        ', rootFromKeccakTree);
  console.log('Roots are equal?:', rootFromComputeFunction === rootFromKeccakTree);
  console.log('==============================\n');

  // THIS TEST SHOULD PASS (roots should be equal) BUT IT WILL FAIL DUE TO THE BUG
  expect(rootFromComputeFunction).toBe(rootFromKeccakTree);
});

test('BUG DOES NOT MANIFEST: Both methods produce SAME root for 1 transaction', async () => {
  // Create a block with 1 transaction (special case - no padding needed)
  const blockNumber = 100;
  const block = createMockBlock(blockNumber, 1);
  const receipts = [createMockReceipt(blockNumber, 0)];

  const rootFromComputeFunction = computeMerkleRootOfBlock(block, receipts, EncodingVersion.V1);

  const { solidityPacked } = require('ethers');
  const { abiEncode } = require('../../src/encodings');

  const encodedTx = block.prefetchedTransactions.map((txData, idx) => {
    const abi = abiEncode(txData, receipts[idx], EncodingVersion.V1);
    const encodedData = solidityPacked(['uint64', 'uint64', 'bytes'], [blockNumber, txData.index, abi.abi]);
    return encodedData;
  });

  const tree = new KeccakMerkleTree(encodedTx);
  const rootFromKeccakTree = tree.getRoot();

  console.log('\n=== MERKLE ROOT COMPARISON (1 TX) ===');
  console.log('Block has 1 transaction (SPECIAL CASE)');
  console.log('Root from computeMerkleRootOfBlock:', rootFromComputeFunction);
  console.log('Root from KeccakMerkleTree:        ', rootFromKeccakTree);
  console.log('Roots are equal?:', rootFromComputeFunction === rootFromKeccakTree);
  console.log('==============================\n');

  // This should pass because with 1 transaction, both take the special case path
  expect(rootFromComputeFunction).toBe(rootFromKeccakTree);
});

test('BUG DOES NOT MANIFEST: Both methods produce SAME root for 4 transactions (power of 2)', async () => {
  // Create a block with 4 transactions (power of 2 - no odd levels)
  const blockNumber = 100;
  const block = createMockBlock(blockNumber, 4);
  const receipts = [
    createMockReceipt(blockNumber, 0),
    createMockReceipt(blockNumber, 1),
    createMockReceipt(blockNumber, 2),
    createMockReceipt(blockNumber, 3),
  ];

  const rootFromComputeFunction = computeMerkleRootOfBlock(block, receipts, EncodingVersion.V1);

  const { solidityPacked } = require('ethers');
  const { abiEncode } = require('../../src/encodings');

  const encodedTx = block.prefetchedTransactions.map((txData, idx) => {
    const abi = abiEncode(txData, receipts[idx], EncodingVersion.V1);
    const encodedData = solidityPacked(['uint64', 'uint64', 'bytes'], [blockNumber, txData.index, abi.abi]);
    return encodedData;
  });

  const tree = new KeccakMerkleTree(encodedTx);
  const rootFromKeccakTree = tree.getRoot();

  console.log('\n=== MERKLE ROOT COMPARISON (4 TXs) ===');
  console.log('Block has 4 transactions (POWER OF 2)');
  console.log('Root from computeMerkleRootOfBlock:', rootFromComputeFunction);
  console.log('Root from KeccakMerkleTree:        ', rootFromKeccakTree);
  console.log('Roots are equal?:', rootFromComputeFunction === rootFromKeccakTree);
  console.log('==============================\n');

  // This should pass because 4 transactions form a balanced tree (no padding needed)
  expect(rootFromComputeFunction).toBe(rootFromKeccakTree);
});

test('BUG MANIFESTS: Different roots for 5 transactions', async () => {
  // Create a block with 5 transactions (odd number)
  const blockNumber = 100;
  const block = createMockBlock(blockNumber, 5);
  const receipts = [
    createMockReceipt(blockNumber, 0),
    createMockReceipt(blockNumber, 1),
    createMockReceipt(blockNumber, 2),
    createMockReceipt(blockNumber, 3),
    createMockReceipt(blockNumber, 4),
  ];

  const rootFromComputeFunction = computeMerkleRootOfBlock(block, receipts, EncodingVersion.V1);

  const { solidityPacked } = require('ethers');
  const { abiEncode } = require('../../src/encodings');

  const encodedTx = block.prefetchedTransactions.map((txData, idx) => {
    const abi = abiEncode(txData, receipts[idx], EncodingVersion.V1);
    const encodedData = solidityPacked(['uint64', 'uint64', 'bytes'], [blockNumber, txData.index, abi.abi]);
    return encodedData;
  });

  const tree = new KeccakMerkleTree(encodedTx);
  const rootFromKeccakTree = tree.getRoot();

  console.log('\n=== MERKLE ROOT COMPARISON (5 TXs) ===');
  console.log('Block has 5 transactions (ODD NUMBER)');
  console.log('Root from computeMerkleRootOfBlock:', rootFromComputeFunction);
  console.log('Root from KeccakMerkleTree:        ', rootFromKeccakTree);
  console.log('Roots are equal?:', rootFromComputeFunction === rootFromKeccakTree);
  console.log('==============================\n');

  // This will fail due to the bug
  expect(rootFromComputeFunction).toBe(rootFromKeccakTree);
});

test('BUG MANIFESTS: Different roots for 6 transactions (even total, but odd at higher level)', async () => {
  // Create a block with 6 transactions
  // 6 transactions -> 3 nodes at level 1 (odd!) -> bug manifests
  const blockNumber = 100;
  const block = createMockBlock(blockNumber, 6);
  const receipts = Array.from({ length: 6 }, (_, i) => createMockReceipt(blockNumber, i));

  const rootFromComputeFunction = computeMerkleRootOfBlock(block, receipts, EncodingVersion.V1);

  const { solidityPacked } = require('ethers');
  const { abiEncode } = require('../../src/encodings');

  const encodedTx = block.prefetchedTransactions.map((txData, idx) => {
    const abi = abiEncode(txData, receipts[idx], EncodingVersion.V1);
    const encodedData = solidityPacked(['uint64', 'uint64', 'bytes'], [blockNumber, txData.index, abi.abi]);
    return encodedData;
  });

  const tree = new KeccakMerkleTree(encodedTx);
  const rootFromKeccakTree = tree.getRoot();

  console.log('\n=== MERKLE ROOT COMPARISON (6 TXs) ===');
  console.log('Block has 6 transactions (EVEN, but level 1 has 3 nodes - ODD)');
  console.log('Root from computeMerkleRootOfBlock:', rootFromComputeFunction);
  console.log('Root from KeccakMerkleTree:        ', rootFromKeccakTree);
  console.log('Roots are equal?:', rootFromComputeFunction === rootFromKeccakTree);
  console.log('==============================\n');

  // This will fail due to the bug
  expect(rootFromComputeFunction).toBe(rootFromKeccakTree);
});
