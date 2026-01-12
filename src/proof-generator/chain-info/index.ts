import { Contract, InterfaceAbi, JsonRpcApiProvider } from 'ethers';

import ChainInfoABI from './chain_info_abi.json';

const contractABI = ChainInfoABI as unknown as InterfaceAbi;

export interface ContinuityBound {
  blockNumber: number;
  digest: string;
}

export interface ContinuityBounds {
  lowerBound: ContinuityBound | null;
  upperBound: ContinuityBound | null;
}

export interface ChainInfoProvider {
  getContinuityBounds(chainKey: number, height: number): Promise<ContinuityBounds>;
  getSupportedChains(): Promise<ChainInfo[]>;
  getLatestAttestedHeightAndHash(chainKey: number): Promise<HeightHash>;
  getAttestationGenesisHeight(chainKey: number): Promise<number>;
  waitUntilHeightAttested(
    chainKey: number,
    targetHeight: number,
    pollIntervalMs?: number,
    waitTimeoutMs?: number,
  ): Promise<void>;
}

/**
 * Default address for the ChainInfo precompile contract
 */
export const CHAIN_INFO_PRECOMPILE_ADDRESS = '0x0000000000000000000000000000000000000fd3';

interface AttestationBounds {
  parentHeight: number;
  parentHash: string;
  parentIsAttestation: boolean;
  childHeight: number;
  childHash: string;
  childIsAttestation: boolean;
  isAttested: boolean;
}

export interface ChainInfo {
  chainKey: number;
  chainId: number;
  chainName: string;
  chainEncoding: number;
}

export interface HeightHash {
  height: number;
  hash: string;
  exists: boolean;
}

export class PrecompileChainInfoProvider implements ChainInfoProvider {
  private chainInfoContract: Contract;

  /**
   * Creates a new PrecompileChainInfoProvider instance
   * @param rpc - The JSON-RPC API provider for blockchain communication
   * @param chainInfoPrecompile - The address of the ChainInfo precompile contract (defaults to standard address)
   */
  constructor(rpc: JsonRpcApiProvider, chainInfoPrecompile: string = CHAIN_INFO_PRECOMPILE_ADDRESS) {
    this.chainInfoContract = new Contract(chainInfoPrecompile, contractABI, rpc);
  }

  /**
   * Retrieves the continuity bounds for a specific chain and block height
   * @param chainKey - The unique identifier for the source chain on the creditcoin network
   * @param height - The block height to query
   * @returns Promise resolving to ContinuityBounds containing lower and upper bounds, or null bounds if not attested
   * @throws Error if the contract call fails or returns invalid data
   */
  public async getContinuityBounds(chainKey: number, height: number): Promise<ContinuityBounds> {
    try {
      const bounds = await this.chainInfoContract.get_attestation_bounds(chainKey, height);

      // Validate bounds structure before casting
      if (!bounds || typeof bounds !== 'object') {
        throw new Error('Invalid data returned from contract: expected object');
      }

      if (bounds.length !== 7) {
        throw new Error(`Invalid data returned from contract: expected 7 fields, got ${bounds.length}`);
      }

      const attestationBounds: AttestationBounds = {
        parentHeight: bounds[0],
        parentHash: bounds[1],
        parentIsAttestation: bounds[2],
        childHeight: bounds[3],
        childHash: bounds[4],
        childIsAttestation: bounds[5],
        isAttested: bounds[6],
      };

      // If the request height is not attested, return null bounds
      if (!attestationBounds.isAttested) {
        return { lowerBound: null, upperBound: null };
      }

      const lowerBounds = attestationBounds.parentIsAttestation
        ? {
            blockNumber: Number(attestationBounds.parentHeight),
            digest: attestationBounds.parentHash,
          }
        : null;

      const upperBounds = attestationBounds.childIsAttestation
        ? {
            blockNumber: Number(attestationBounds.childHeight),
            digest: attestationBounds.childHash,
          }
        : null;

      return {
        lowerBound: lowerBounds,
        upperBound: upperBounds,
      };
    } catch (error) {
      throw new Error(`Error calling contract method: ${error}`);
    }
  }

  /**
   * Retrieves information about all supported source chains on the creditcoin network
   * @returns Promise resolving to an array of ChainInfo objects containing chain details
   * @throws Error if the contract call fails or returns invalid data
   */
  public async getSupportedChains(): Promise<ChainInfo[]> {
    try {
      const chains = await this.chainInfoContract.get_supported_chains();

      // Validate contract output structure before casting
      if (!chains || typeof chains !== 'object') {
        throw new Error('Invalid bounds returned from contract: expected object');
      }

      if (chains.length === 0) {
        return [];
      }

      const chainInfo: ChainInfo[] = chains.map((chainEntry: any) => {
        // Validate entry structure try to extract fields
        if (!chainEntry || typeof chainEntry !== 'object') {
          throw new Error('Invalid chain info entry: expected object');
        }

        if (chainEntry.length !== 4) {
          throw new Error(
            `Invalid chain info entry returned from contract: expected 4 fields, got ${chainEntry.length}`,
          );
        }

        return {
          chainKey: Number(chainEntry[0]),
          chainId: Number(chainEntry[1]),
          chainName: chainEntry[2], // TODO: Name decoding seems to be failing, investigate (you get all zeros currently)
          chainEncoding: Number(chainEntry[3]),
        };
      });

      return chainInfo;
    } catch (error) {
      throw new Error(`Error calling contract method: ${error}`);
    }
  }

  /**
   * Gets the latest attested block height and hash for a specific chain
   * @param chainKey - The unique identifier for the source chain on the creditcoin network
   * @returns Promise resolving to HeightHash object containing height, hash, and existence status
   * @throws Error if the contract call fails or returns invalid data
   */
  public async getLatestAttestedHeightAndHash(chainKey: number): Promise<HeightHash> {
    try {
      const heightHash = await this.chainInfoContract.get_latest_attestation_height_and_hash(chainKey);

      // Validate bounds structure before casting
      if (!heightHash || typeof heightHash !== 'object') {
        throw new Error('Invalid data returned from contract: expected object');
      }

      if (heightHash.length !== 3) {
        throw new Error(`Invalid data returned from contract: expected 3 fields, got ${heightHash.length}`);
      }

      const heightHashObj: HeightHash = {
        height: Number(heightHash[0]),
        hash: heightHash[1],
        exists: heightHash[2],
      };

      return heightHashObj;
    } catch (error) {
      throw new Error(`Error calling contract method: ${error}`);
    }
  }

  /**
   * Retrieves the genesis height for attestations on a specific chain
   * @param chainKey - The unique identifier for the source chain on the creditcoin network
   * @returns Promise resolving to the genesis height as a bigint
   * @throws Error if the contract call fails or returns invalid data
   */
  public async getAttestationGenesisHeight(chainKey: number): Promise<number> {
    try {
      const genesisHeight = await this.chainInfoContract.get_attestation_genesis_height(chainKey);

      // Validate output structure before returning
      if (typeof genesisHeight !== 'bigint') {
        throw new Error('Invalid data returned from contract: expected genesis height');
      }

      return Number(genesisHeight);
    } catch (error) {
      throw new Error(`Error calling contract method: ${error}`);
    }
  }

  /**
   * Waits until a specific block height is attested on a chain
   * @param chainKey - The unique identifier for the source chain on the creditcoin network
   * @param targetHeight - The block height to wait for attestation
   * @param pollIntervalMs - How often to check for attestation (default: 5000ms)
   * @param waitTimeoutMs - Maximum time to wait before timing out (default: 60000ms)
   * @returns Promise that resolves when the target height is attested
   * @throws Error if the timeout is exceeded before the height is attested
   */
  public async waitUntilHeightAttested(
    chainKey: number,
    targetHeight: number,
    pollIntervalMs: number = 5000,
    waitTimeoutMs: number = 60000,
  ): Promise<void> {
    const startTime = Date.now();

    while (true) {
      const heightHash = await this.getLatestAttestedHeightAndHash(chainKey);
      if (heightHash.exists && heightHash.height >= targetHeight) {
        return;
      }

      if (Date.now() - startTime > waitTimeoutMs) {
        throw new Error(`Timeout waiting for height ${targetHeight} to be attested on chain key ${chainKey}`);
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }
}
