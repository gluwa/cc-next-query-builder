import { mkdirSync, writeFileSync } from 'fs';
import { JsonRpcProvider } from 'ethers';
import { abiEncode } from '../encodings/abi';

async function encodeTransaction(provider: JsonRpcProvider, txHash: string): Promise<string> {
  // 80 credits
  const transaction = await provider.getTransaction(txHash);
  // 80 credits
  const receipt = await provider.getTransactionReceipt(txHash);
  const encodedData = abiEncode(transaction!, receipt!);
  return encodedData.abi;
}

// https://docs.metamask.io/services/get-started/pricing/credit-cost#standard-ethereum-compliant-methods
// cost: (80 + 160 * <txns in block>)
async function blockHandler(
  prefix: string,
  provider: JsonRpcProvider,
  blockNumber: number,
  pathToStoreJson: string,
): Promise<void> {
  console.log(`new ${prefix} --- ${blockNumber}`);

  mkdirSync(`${pathToStoreJson}/${blockNumber}`, { recursive: true });

  // cost: 80 credits
  const block = await provider.getBlock(blockNumber);
  const txHashes = block?.transactions || [];

  await Promise.all(
    txHashes.map(async (txHash) => {
      // cost: 160 credits
      const encodedData = await encodeTransaction(provider, txHash);

      writeFileSync(`${pathToStoreJson}/${blockNumber}/${txHash}.txt`, encodedData + '\n', {
        flag: 'w',
      });
    }),
  );

  console.log(`<<< done encoding ${txHashes?.length} transactions in block ${blockNumber}`);
}

async function encodeBlocks(rpcUrl: string, pathToStoreJson: string): Promise<void> {
  mkdirSync(pathToStoreJson, { recursive: true });

  const provider = new JsonRpcProvider(rpcUrl);

  // Fire the event whenever the block changes.
  // We can also fire on 'safe' or 'finalized' blocks
  provider.on('block', async (blockNumber) => {
    // cost: (80 + 160 * <txns in block>)
    await blockHandler('block', provider, blockNumber, pathToStoreJson);
  });

  // try explicitly querying a block range of 1000 blocks
  // WARNING: this always hits rate limits
  //  const latestBlock = await provider.getBlock('latest');
  //  const latestNumber = latestBlock?.number || 0;
  //  console.log(`*** starting latest block is ${latestNumber}`);
  //  for (let blockNumber = latestNumber - 1000; blockNumber < latestNumber; blockNumber++) {
  //    await blockHandler("explicit", provider, blockNumber);
  //  }
}

if (process.argv.length < 4) {
  console.error('node dist/bin/encode-blocks.js <ethRpcUrl> <pathToStoreJson>');
  process.exit(1);
}

const rpcUrl = process.argv[2] || 'http://127.0.0.1:8545';
const pathToStoreJson = process.argv[3];

encodeBlocks(rpcUrl, pathToStoreJson).catch((reason) => {
  console.error(reason);
  process.exit(1);
});
