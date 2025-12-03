import * as fs from 'fs';
import * as path from 'path';

import { JsonRpcProvider, Block, TransactionReceipt } from 'ethers';

const CACHE_DIR = path.join(process.cwd(), 'cache');
const BLOCKS_CACHE_DIR = path.join(CACHE_DIR, 'blocks');

/**
 * Cached block data structure
 * Stores raw RPC responses for efficient reconstruction
 */
interface CachedBlockData {
  height: number;
  blockData: any; // Raw block data from RPC (from eth_getBlockByNumber)
  receiptsData: any[]; // Raw receipts data from RPC (from eth_getBlockReceipts)
}

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
  if (!fs.existsSync(BLOCKS_CACHE_DIR)) {
    fs.mkdirSync(BLOCKS_CACHE_DIR, { recursive: true });
  }
}

function getBlockCacheFilePath(height: number): string {
  return path.join(BLOCKS_CACHE_DIR, `${height}.json`);
}

function loadBlockCache(height: number): CachedBlockData | null {
  ensureCacheDir();

  const filePath = getBlockCacheFilePath(height);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data) as CachedBlockData;
  } catch (error) {
    console.warn(`Error loading cache for block ${height}, will refetch:`, error);
    return null;
  }
}

function saveBlockCache(blockData: CachedBlockData): void {
  ensureCacheDir();

  const filePath = getBlockCacheFilePath(blockData.height);

  try {
    fs.writeFileSync(filePath, JSON.stringify(blockData, null, 2));
  } catch (error) {
    console.warn(`Error saving cache for block ${blockData.height}:`, error);
  }
}

function getCachedBlockAndReceipts(
  rpc: JsonRpcProvider,
  height: number,
): { block: Block; receipts: TransactionReceipt[] } | null {
  const cached = loadBlockCache(height);

  if (!cached) {
    return null;
  }

  try {
    // Reconstruct Block from raw RPC data
    // Block.from() can reconstruct from the raw RPC response format
    const block = (rpc as any)._wrapBlock(cached.blockData, true);

    // Reconstruct receipts using the provider's wrap method
    // This ensures they're properly typed and have all methods
    const receipts = cached.receiptsData.map((receiptData: any) => {
      return rpc._wrapTransactionReceipt(receiptData, rpc._network);
    });

    return { block, receipts };
  } catch (error) {
    console.warn(`Error reconstructing cached block ${height}, will refetch:`, error);
    console.log(`Cache reconstruction failed for block ${height}`);
    return null;
  }
}

function cacheBlockAndReceipts(
  height: number,
  blockData: any, // Raw RPC response from eth_getBlockByNumber
  receiptsData: any[], // Raw receipts data from RPC (from eth_getBlockReceipts)
): void {
  console.log(`Caching block ${height} with ${receiptsData.length} receipts`);

  const cachedData: CachedBlockData = {
    height,
    blockData,
    receiptsData,
  };

  saveBlockCache(cachedData);
  console.log(`Successfully cached block ${height}`);
}

/**
 * Helper function to get block and receipts with caching.
 * Fetches from RPC if not cached, otherwise uses cache.
 *
 * @param rpc - The JsonRpcProvider instance
 * @param height - The block height
 * @returns Block and receipts array
 */
export async function getBlockAndReceiptsWithCache(
  rpc: JsonRpcProvider,
  height: number,
): Promise<{ block: Block; receipts: TransactionReceipt[] }> {
  // Check cache first
  const cached = getCachedBlockAndReceipts(rpc, height);
  if (cached) {
    return cached;
  }

  // just slow down a bit to let the RPC cool down.
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Not in cache, fetch from RPC
  // Get raw block data with transactions prefetched
  const blockDataRaw = await rpc.send('eth_getBlockByNumber', [`0x${height.toString(16)}`, true]);
  if (!blockDataRaw) {
    throw new Error(`Block ${height} not found`);
  }

  // just slow down a bit to let the RPC cool down.
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Get raw receipts data
  const receiptsDataRaw = await rpc.send('eth_getBlockReceipts', [`0x${height.toString(16)}`]);

  // Wrap into ethers objects for use using provider's wrap methods
  const block = (rpc as any)._wrapBlock(blockDataRaw, true);
  const receipts = receiptsDataRaw.map((r: any) => rpc._wrapTransactionReceipt(r, rpc._network));

  // Cache the raw data for future use
  cacheBlockAndReceipts(height, blockDataRaw, receiptsDataRaw);

  return { block, receipts };
}
