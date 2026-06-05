import { mkdirSync, writeFileSync } from 'fs';
import { Block, WebSocketProvider, TransactionReceipt } from 'ethers';
import { abiEncode } from '../encoding/abi';
import { getTransactionWithRaw } from '../encoding';

/**
 * Gets all transaction receipts for a given block using regular Infura/compatible RPC format.
 * Uses hexadecimal block number format (e.g., "0x1a2b3c").
 *
 * @param rpc - The ethers JsonRpcApiProvider instance
 * @param block - The block to get receipts for
 * @returns Array of transaction receipts for the block
 */
async function getBlockReceipts(rpc: WebSocketProvider, block: Block): Promise<TransactionReceipt[]> {
  // Regular Infura/compatible RPC takes block number as hexadecimal string
  const finalBlockNumber = `0x${block.number.toString(16)}`;

  // Call the RPC method to get all receipts for the block
  const receiptsRaw: Array<any> = await rpc.send('eth_getBlockReceipts', [finalBlockNumber]);

  // Wrap raw receipts into proper TransactionReceipt objects
  const receipts = receiptsRaw.map((r) => {
    const receipt = rpc._wrapTransactionReceipt(r, rpc._network);
    return receipt;
  });

  return receipts;
}

// cost 80 or 160 credits depnding on arguments
async function encodeTransaction(
  provider: WebSocketProvider,
  txHash: string,
  receipt: TransactionReceipt | null,
): Promise<string> {
  // 80 credits
  const transaction = await getTransactionWithRaw(provider, txHash);

  if (receipt === null) {
    // 80 credits
    receipt = await provider.getTransactionReceipt(txHash);
  }
  const encodedData = abiEncode(transaction!, receipt!);
  return encodedData.abi;
}

async function encodeAndWriteToDisk(
  pathToStoreJson: string,
  provider: WebSocketProvider,
  blockNumber: number,
  txHash: string,
  receipt: TransactionReceipt | null,
) {
  const encodedData = await encodeTransaction(provider, txHash, receipt);

  writeFileSync(`${pathToStoreJson}/${blockNumber}/${txHash}.txt`, encodedData + '\n', {
    flag: 'w',
  });
}

// https://docs.metamask.io/services/get-started/pricing/credit-cost#standard-ethereum-compliant-methods
// cost: (80 + 160 * <txns in block>)
async function blockHandler(
  prefix: string,
  provider: WebSocketProvider,
  blockNumber: number,
  pathToStoreJson: string,
): Promise<void> {
  console.log(`new ${prefix} --- ${blockNumber}`);

  mkdirSync(`${pathToStoreJson}/${blockNumber}`, { recursive: true });

  // cost: 80 credits
  const block = await provider.getBlock(blockNumber);
  const txHashes = block?.transactions || [];

  if (txHashes?.length >= 13) {
    // optimize RPC cost by fetching all receipts at once
    const receipts = await getBlockReceipts(provider, block!);

    await Promise.all(
      receipts.map(async (receipt) => {
        await encodeAndWriteToDisk(pathToStoreJson, provider, blockNumber, receipt.hash, receipt);
      }),
    );
  } else {
    // loop over each transaction and fetch its receipt via explicit RPC call
    await Promise.all(
      txHashes.map(async (txHash) => {
        await encodeAndWriteToDisk(pathToStoreJson, provider, blockNumber, txHash, null);
      }),
    );
  }

  console.log(`<<< done encoding ${txHashes?.length} transactions in block ${blockNumber}`);
}

async function encodeBlocks(rpcUrl: string, pathToStoreJson: string): Promise<void> {
  const start = Date.now();
  const timeoutMinutes = parseInt(process.env.TIMEOUT_MINUTES || '2');
  console.log(`=== starting with timeout ${timeoutMinutes} mins ...`);

  mkdirSync(pathToStoreJson, { recursive: true });

  const provider = new WebSocketProvider(rpcUrl);

  // Fire only on finalized blocks so we never encode reorgable state.
  // ethers v6 supports 'finalized' (and 'safe') alongside 'block' as provider events.
  provider.on('finalized', async (blockNumber) => {
    // cost: (80 + 160 * <txns in block>)
    await blockHandler('finalized', provider, blockNumber, pathToStoreJson);

    if (Math.floor((Date.now() - start) / 60000) >= timeoutMinutes) {
      console.log(`=== ${timeoutMinutes} mins timeout reached. exiting ...`);
      process.exit(0);
    }
  });
}

if (process.argv.length < 4) {
  console.error('node dist/bin/encode-blocks.js <ws://ethRpcUrl> <pathToStoreJson>');
  process.exit(1);
}

const rpcUrl = process.argv[2] || 'ws://127.0.0.1:8545';
const pathToStoreJson = process.argv[3];

encodeBlocks(rpcUrl, pathToStoreJson).catch((reason) => {
  console.error(reason);
  process.exit(1);
});
