import axios from 'axios';
import { readdirSync, readFileSync, statSync } from 'fs';
import { glob } from 'glob';
import { BaseContract, Contract, Wallet, WebSocketProvider } from 'ethers';
import type { InterfaceAbi } from 'ethers';
import { abiEncode } from '../encoding/abi';
import { getTransactionWithRaw } from '../encoding';
import { decoder } from '../utils';
import EvmV1DecoderABI from '../utils/evmV1DecoderAbi.json';
import { blockProver, proofProvider } from '../';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function getProofForTxn(apiUrl: string, chainKey: number, txn: string) {
  const url = `${apiUrl}/api/v1/proof-by-tx/${chainKey}/${txn}`;
  try {
    // NOTE: throws an exception in case of errors
    return await axios.get(url);
  } catch (error) {
    // The prover returns HTTP 422 with code 'EmptyBlockTxProof' for blocks
    // that contain no transactions; there is no tx proof to verify, so we
    // treat this as a skip rather than a hard failure. Any other error is
    // re-thrown so genuine problems still surface and fail the run.
    if (
      axios.isAxiosError(error) &&
      error.response?.status === 422 &&
      (error.response?.data?.code === 'EmptyBlockTxProof' || error.response?.data?.code === 'BlockNotReady')
    ) {
      return null;
    }

    // usually means block is within the source chain's reorg-protection window and is not yet confirmed.
    // skip it b/c this workflow usually operates on latest blocks and we don't want to fail
    // b/c of that
    if (
      axios.isAxiosError(error) &&
      error.response?.status === 404 &&
      error.response?.data?.code === 'BlockNotOnSourceChain'
    ) {
      return null;
    }

    throw error;
  }
}

async function decodeFromDisk(
  pathToTxn: string,
  decodeContract: Contract,
  proverPrecompileWithSigner: BaseContract,
  proverBaseUrl: string,
  chainKey: number,
) {
  const verifyAndEmitSingleFragment =
    'verifyAndEmit(uint64,uint64,bytes,(bytes32,(bytes32,bool)[]),(bytes32,bytes32[]))';

  const pathComponents = pathToTxn.replace('.txt', '').split('/');
  const txHash = pathComponents[pathComponents.length - 1];

  console.log(`... get proof for source txn ${txHash}`);
  await sleep(500); // rate-limit

  let gasForVerification = 0n;
  const response = await getProofForTxn(proverBaseUrl, chainKey, txHash);
  if (response !== null) {
    const proofData = response.data as proofProvider.ContinuityResponse;

    const estimate = await proverPrecompileWithSigner
      .getFunction(verifyAndEmitSingleFragment)
      .estimateGas(
        proofData.chainKey,
        proofData.headerNumber,
        proofData.txBytes,
        proofData.merkleProof,
        proofData.continuityProof,
      );
    gasForVerification = BigInt(estimate);
  }
  console.log(`    ... gasForVerification=${gasForVerification} - 0 means skipped`);

  // Reject any single transaction whose individual gas cost crosses the
  // per-transaction cap. A single tx must fit comfortably within a block
  // on its own, so each estimate is checked against singleTxnGasLimit as
  // soon as it becomes available.
  const singleTxnGasLimit = 25_000_000n;
  if (gasForVerification >= singleTxnGasLimit) {
    throw new Error(
      `gasForVerification ${gasForVerification} reaches or exceeds the single transaction gas limit (${singleTxnGasLimit}); failing run`,
    );
  }

  const encodedData = readFileSync(pathToTxn, {
    encoding: 'utf8',
    flag: 'r',
  }).trim();

  const decoded = await decoder.decodeEvmV1Transaction(encodedData, decodeContract, {
    trackGas: true,
  });
  const gasForDecoding = decoded.gasUsed ?? BigInt(0);
  console.log(`     decoded as type ${decoded.type}, gasForDecoding=${gasForDecoding}`);
  if (gasForDecoding >= singleTxnGasLimit) {
    throw new Error(
      `gasForDecoding ${gasForDecoding} reaches or exceeds the single transaction gas limit (${singleTxnGasLimit}); failing run`,
    );
  }

  // Add a 10% safety margin to the raw estimates and reject if the
  // combined cost crosses 70% of the 75M block gas limit. Using bigint
  // math (11/10 and 7/10) keeps the value precise and consistent with
  // the rest of the script. The 70% threshold is an explicit decision;
  // see commit log + linked Slack thread for context.
  const totalGas = ((gasForVerification + gasForDecoding) * 11n) / 10n;
  const blockGasLimit = 75_000_000n;
  const totalGasThreshold = (blockGasLimit * 7n) / 10n;
  console.log(`    ... totalGas (with 10% margin)=${totalGas} (threshold=${totalGasThreshold})`);
  if (totalGas >= singleTxnGasLimit) {
    throw new Error(
      `totalGas ${totalGas} reaches or exceeds the single transaction gas limit (${singleTxnGasLimit}); failing run`,
    );
  }
  if (totalGas >= totalGasThreshold) {
    throw new Error(
      `totalGas ${totalGas} reaches or exceeds 70% of the ${blockGasLimit} block gas limit (${totalGasThreshold}); failing run`,
    );
  }
}

async function decodeBlocks(
  creditcoinUrl: string,
  proverUrl: string,
  decoderLibraryAddress: string,
  pathToStore: string,
  chainKey: number,
): Promise<void> {
  const creditcoinWs = new WebSocketProvider(creditcoinUrl);
  const decodeContract = new Contract(decoderLibraryAddress, EvmV1DecoderABI as InterfaceAbi, creditcoinWs);

  const proverPrecompile = new blockProver.PrecompileBlockProver(creditcoinWs);
  const proverPrecompileWithSigner = proverPrecompile.blockProverContract.connect(
    Wallet.createRandom().connect(creditcoinWs),
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
    await decodeFromDisk(txFile, decodeContract, proverPrecompileWithSigner, proverUrl, chainKey);
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
const proverUrl = process.argv[3];
const evmV1DecoderAddress = process.argv[4];
const pathToStore = process.argv[5];
const chainKey = parseInt(process.argv[6]);

decodeBlocks(rpcUrl, proverUrl, evmV1DecoderAddress, pathToStore, chainKey).catch((reason) => {
  console.error(reason);
  process.exit(1);
});
