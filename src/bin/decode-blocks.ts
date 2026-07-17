import { readdirSync, readFileSync, statSync } from 'fs';
import { glob } from 'glob';
import { Contract, WebSocketProvider } from 'ethers';
import type { InterfaceAbi } from 'ethers';
import { abiEncode } from '../encoding/abi';
import { getTransactionWithRaw } from '../encoding';
import { decoder } from '../utils';
import EvmV1DecoderABI from '../utils/evmV1DecoderAbi.json';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Block gas threshold mirrored from gluwa/creditcoin3
// cli/src/scripts/prover-check.ts (verifyProofs): fail if the gas with a
// 10% safety margin reaches or exceeds 70% of the 75M block gas limit.
//
// IMPORTANT: unlike prover-check.ts, this check covers DECODE gas ONLY.
// There is no verifyAndEmit()/on-chain verification call here, so the
// margin is applied purely to the decode estimate (no gasForVerification
// term). Kept as bigint math (11/10 and 7/10) to stay precise.
const BLOCK_GAS_LIMIT = BigInt(75_000_000);
const DECODE_GAS_THRESHOLD = (BLOCK_GAS_LIMIT * BigInt(7)) / BigInt(10);

async function decodeFromDisk(pathToTxn: string, contract: Contract) {
  const encodedData = readFileSync(pathToTxn, {
    encoding: 'utf8',
    flag: 'r',
  }).trim();

  const decoded = await decoder.decodeEvmV1Transaction(encodedData, contract, {
    trackGas: true,
  });
  const decodeGas = decoded.gasUsed ?? BigInt(0);
  console.log(`     decoded as type ${decoded.type}, decodeGas=${decodeGas}`);

  // Apply a 10% safety margin to the DECODE gas only (no verifyAndEmit()
  // call is made here) and reject if it crosses 70% of the block gas limit.
  const decodeGasWithMargin = (decodeGas * BigInt(11)) / BigInt(10);
  console.log(
    `     decodeGasWithMargin (decode-only, +10%)=${decodeGasWithMargin} (threshold=${DECODE_GAS_THRESHOLD})`,
  );
  if (decodeGasWithMargin >= DECODE_GAS_THRESHOLD) {
    throw new Error(
      `decodeGasWithMargin ${decodeGasWithMargin} (decode-only, no verifyAndEmit) reaches or exceeds 70% of the ${BLOCK_GAS_LIMIT} block gas limit (${DECODE_GAS_THRESHOLD}); failing run (file=${pathToTxn})`,
    );
  }
}

async function decodeBlocks(creditcoinUrl: string, decoderLibraryAddress: string, pathToStore: string): Promise<void> {
  const contract = new Contract(
    decoderLibraryAddress,
    EvmV1DecoderABI as InterfaceAbi,
    new WebSocketProvider(creditcoinUrl),
  );

  const txnFiles = await glob('*/**.txt', { cwd: pathToStore, absolute: true });
  txnFiles.sort();
  const numFiles = txnFiles.length;
  console.log(`INFO: found ${numFiles} transactions to decode`);

  if (numFiles === 0) {
    throw new Error('0 files found to decode. Something is wrong. Please investigate');
  }

  for (const [idx, txFile] of txnFiles.entries()) {
    console.log(`>>>> ${idx}/${numFiles} decoding ${txFile}`);
    await decodeFromDisk(txFile, contract);
    // await sleep(50); // rate-limit ourselves
  }
  console.log(`DONE`);
  process.exit(0);
}

if (process.argv.length < 5) {
  console.error('node dist/bin/decode-blocks.js <ws://creditcoinRpcUrl> <evmV1DecoderAddress> <pathToStore>');
  process.exit(1);
}

const rpcUrl = process.argv[2] || 'ws://127.0.0.1:9944';
const evmV1DecoderAddress = process.argv[3];
const pathToStore = process.argv[4];

decodeBlocks(rpcUrl, evmV1DecoderAddress, pathToStore).catch((reason) => {
  console.error(reason);
  process.exit(1);
});
