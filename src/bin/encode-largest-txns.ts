import { mkdirSync, writeFileSync } from 'fs';
import { WebSocketProvider, TransactionReceipt } from 'ethers';
import { abiEncode } from '../encoding/abi';
import { getTransactionWithRaw } from '../encoding';
import { bytesInHexString } from '../utils/hex';

// The 8 largest transactions ever observed successfully-encoded on Ethereum
// Mainnet. Historically these were only documented as a comment inside
// encode-blocks.ts; the streaming encoder relied on eventually re-encountering
// blocks of this size on the live head. That is slow and non-deterministic.
//
// This binary instead queries these exact block/tx pairs directly so they can
// be encoded (and decoded downstream) on every CI run, giving a deterministic
// worst-case coverage check. Sepolia is intentionally unsupported here: these
// are mainnet-only fixtures.
interface LargeTxn {
  blockNumber: number;
  txHash: string;
}

const LARGEST_MAINNET_TXNS: LargeTxn[] = [
  { blockNumber: 25602727, txHash: '0x4e94d836e6e2794556e1cbb3a2cfb1945248d156c97b5d902835dbd9a4b88e60' },
  { blockNumber: 25599245, txHash: '0x24a6129734163346da53f056a8022f3ec37d70b8350ed9b8300620bbbdba6e1e' },
  { blockNumber: 25551628, txHash: '0x181611bff5f83dcf85cc45e06a453ee79a4ca1a697a1316030e655901c71bee8' },
  { blockNumber: 25551622, txHash: '0x296d83e8a0db263ad06422be8c6bd426c70785cc7c4f2b0b559eec5586e9da86' },
  { blockNumber: 25238768, txHash: '0x01ca130bf04e636d26ebdf0f6256a99894a6b474d4c016af74849c6a7572928d' },
  { blockNumber: 25238750, txHash: '0x343b91c47944693ed1cdf3c979bd7722ed9284320ff6069bcfd46c109d9c4199' },
  { blockNumber: 25238749, txHash: '0x5f60979ee18aba3f76122574e987f974fb1d7bacc372666f4b3f647236d54794' },
  { blockNumber: 25238746, txHash: '0xf2641f3bd13a111169c007205b3d1e7188201df3ae041991d2e1e3745ed1fb2d' },
];

// Maximum discovered size of ABI-encoded transaction data, in bytes.
// Derived from the largest observed successfully-encoded transactions above.
const MAX_ENCODED_SIZE = 530336;

// cost 80 or 160 credits depending on arguments
async function encodeTransaction(
  provider: WebSocketProvider,
  txHash: string,
  receipt: TransactionReceipt | null,
): Promise<string> {
  // 80 credits
  const transaction = await getTransactionWithRaw(provider, txHash);
  if (transaction === null) {
    throw new Error(`transaction ${txHash} not found via RPC`);
  }

  if (receipt === null) {
    // 80 credits
    receipt = await provider.getTransactionReceipt(txHash);
  }
  if (receipt === null) {
    throw new Error(`receipt for ${txHash} not found via RPC`);
  }

  const encodedData = abiEncode(transaction, receipt);
  return encodedData.abi;
}

async function encodeAndWriteToDisk(
  pathToStoreJson: string,
  provider: WebSocketProvider,
  blockNumber: number,
  txHash: string,
): Promise<void> {
  const encodedData = await encodeTransaction(provider, txHash, null);

  const encodedSize = bytesInHexString(encodedData);
  if (encodedSize > MAX_ENCODED_SIZE) {
    // Do NOT abort: we still want to encode and persist oversized transactions
    // so the run continues. Log in the exact `encoded data exceeds
    // MAX_ENCODED_SIZE` format so a downstream CI step can grep for it and fail
    // the pipeline.
    console.error(
      `encoded data exceeds MAX_ENCODED_SIZE: blockNumber=${blockNumber} txHash=${txHash} encodedSize=${encodedSize} bytes (max=${MAX_ENCODED_SIZE})`,
    );
  }

  mkdirSync(`${pathToStoreJson}/${blockNumber}`, { recursive: true });
  writeFileSync(`${pathToStoreJson}/${blockNumber}/${txHash}.txt`, encodedData + '\n', {
    flag: 'w',
  });
}

async function encodeLargestTxns(rpcUrl: string, pathToStoreJson: string): Promise<void> {
  console.log(`=== encoding ${LARGEST_MAINNET_TXNS.length} largest mainnet transactions ...`);

  mkdirSync(pathToStoreJson, { recursive: true });

  const provider = new WebSocketProvider(rpcUrl);

  try {
    // Encode each documented transaction directly by hash. We fail the whole
    // run on any error: unlike the streaming encoder (which skips transient
    // failures on live blocks), these are fixed historical fixtures and must
    // always be retrievable/encodable.
    for (const { blockNumber, txHash } of LARGEST_MAINNET_TXNS) {
      console.log(`--- encoding block ${blockNumber} txn ${txHash}`);
      await encodeAndWriteToDisk(pathToStoreJson, provider, blockNumber, txHash);
    }
    console.log(`<<< done encoding ${LARGEST_MAINNET_TXNS.length} transactions`);
  } finally {
    await provider.destroy();
  }
}

if (process.argv.length < 4) {
  console.error('node dist/bin/encode-largest-txns.js <ws://ethMainnetRpcUrl> <pathToStoreJson>');
  process.exit(1);
}

const rpcUrl = process.argv[2] || 'ws://127.0.0.1:8545';
const pathToStoreJson = process.argv[3];

encodeLargestTxns(rpcUrl, pathToStoreJson).catch((reason) => {
  console.error(reason);
  process.exit(1);
});
