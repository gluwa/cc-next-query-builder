import { Block, JsonRpcApiProvider, TransactionReceipt, TransactionResponse } from 'ethers';

/**
 * Abstract interface for an Ethereum block provider.
 */
export interface BlockProvider {
  getBlockNumber(): Promise<number>;
  getTransaction(transactionHash: string): Promise<TransactionResponse | null>;
  getBlockWithReceipts(blockNumber: number): Promise<{ block: Block; receipts: TransactionReceipt[] }>;
}

/**
 * Simple implementation of BlockProvider using an implementation of ethers JsonRpcApiProvider.
 *
 * Has no caching or optimizations.
 */
export class SimpleBlockProvider implements BlockProvider {
  private rpc: JsonRpcApiProvider;

  constructor(rpc: JsonRpcApiProvider) {
    this.rpc = rpc;
  }

  public getBlockNumber(): Promise<number> {
    return this.rpc.getBlockNumber();
  }

  public async getTransaction(transactionHash: string): Promise<TransactionResponse | null> {
    return this.rpc.getTransaction(transactionHash);
  }

  public async getBlockWithReceipts(blockNumber: number): Promise<{ block: Block; receipts: TransactionReceipt[] }> {
    // just slow down a bit to let the RPC cool down.
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Not in cache, fetch from RPC
    // Get raw block data with transactions prefetched
    const blockDataRaw = await this.rpc.send('eth_getBlockByNumber', [`0x${blockNumber.toString(16)}`, true]);
    if (!blockDataRaw) {
      throw new Error(`Block ${blockNumber} not found`);
    }

    // just slow down a bit to let the RPC cool down.
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Get raw receipts data
    const receiptsDataRaw = await this.rpc.send('eth_getBlockReceipts', [`0x${blockNumber.toString(16)}`]);

    // Wrap into ethers objects for use using provider's wrap methods
    const block = (this.rpc as any)._wrapBlock(blockDataRaw, true);
    const receipts = receiptsDataRaw.map((r: any) => this.rpc._wrapTransactionReceipt(r, this.rpc._network));

    return { block, receipts };
  }
}
