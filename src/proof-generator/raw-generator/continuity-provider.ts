import { Contract, InterfaceAbi, Wallet } from 'ethers';

import ChainInfoABI from './chain_info.json';

const contractABI = ChainInfoABI as unknown as InterfaceAbi;

export interface ContinuityBound {
  blockNumber: number;
  digest: string;
}

export interface ContinuityBounds {
  lowerBound: ContinuityBound | null;
  upperBound: ContinuityBound | null;
}

export interface ContinuityProvider {
  getContinuityBounds(chainKey: number, height: number): Promise<ContinuityBounds>;
}

/**
 * Default address for the ChainInfo precompile contract
 */
export const PRECOMPILE_CONTRACT_ADDRESS = '0x0000000000000000000000000000000000000fd3';

export const DEFAULT_GAS_PRICE = 10000000;
export const DEFAULT_GAS_LIMIT = 10000000;

interface AttestationBounds {
  parentHeight: bigint;
  parentHash: string;
  parentIsAttestation: boolean;
  childHeight: bigint;
  childHash: string;
  childIsAttestation: boolean;
  isAttested: boolean;
}

export class PrecompileContinuityProvider implements ContinuityProvider {
  private wallet: Wallet;
  private chainInfoContract: Contract;

  private gasPrice: number;
  private gasLimit: number;

  constructor(
    wallet: Wallet,
    precompileAddress: string = PRECOMPILE_CONTRACT_ADDRESS,
    gasPrice: number = DEFAULT_GAS_PRICE,
    gasLimit: number = DEFAULT_GAS_LIMIT,
  ) {
    this.wallet = wallet;
    this.chainInfoContract = new Contract(precompileAddress, contractABI, this.wallet);

    this.gasPrice = gasPrice;
    this.gasLimit = gasLimit;
  }

  public async getContinuityBounds(chainKey: number, height: number): Promise<ContinuityBounds> {
    try {
      const bounds = await this.chainInfoContract.get_attestation_bounds(chainKey, height, {
        gasPrice: this.gasPrice,
        gasLimit: this.gasLimit,
      });

      const attBounds = bounds as AttestationBounds;

      // If the request height is not attested, return null bounds
      if (!attBounds.isAttested) {
        return { lowerBound: null, upperBound: null };
      }

      const lowerBounds = attBounds.parentIsAttestation
        ? {
            blockNumber: Number(attBounds.parentHeight),
            digest: attBounds.parentHash,
          }
        : null;

      const upperBounds = attBounds.childIsAttestation
        ? {
            blockNumber: Number(attBounds.childHeight),
            digest: attBounds.childHash,
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
}
