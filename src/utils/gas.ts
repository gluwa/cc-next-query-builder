import { Contract, JsonRpcApiProvider } from 'ethers';

/**
 * Estimates gas for a contract call and returns a gas limit with a buffer
 * applied. When gas estimation fails (e.g. due to known issues with
 * precompiles where `pallet-evm` does not propagate revert reasons during
 * estimation mode), falls back to a heuristic based on the continuity
 * proof size, matching the Rust logic.
 *
 * Ported from gluwa/usc-testnet-bridge-examples#77
 * (decode-testing/submit_decode_query.ts).
 */
export async function computeGasLimit(
  provider: JsonRpcApiProvider,
  contract: Contract,
  data: string,
  from: string,
  continuityLength: number,
): Promise<bigint> {
  const GAS_BUFFER_MULTIPLIER = 135; // 100% + 35% buffer
  // Estimate gas and add buffer
  console.log('⏳ Estimating gas...');

  let gasLimit;
  try {
    const estimatedGas = await provider.estimateGas({
      to: contract.getAddress(),
      data,
      from,
    });
    gasLimit = (estimatedGas * BigInt(GAS_BUFFER_MULTIPLIER)) / BigInt(100);
    console.log(`   Estimated gas: ${estimatedGas.toString()}, Gas limit with buffer: ${gasLimit.toString()}`);
  } catch (error: any) {
    // Gas estimation can fail even when the call would succeed
    // This is a known issue with precompiles - pallet-evm doesn't always
    // properly propagate revert reasons during estimation mode
    // Calculate a reasonable estimate based on continuity proof size (matching Rust logic)
    // Base: 21000 (tx) + ~5000 per continuity block + ~10000 for merkle + overhead
    const calculatedGas = 21000 + continuityLength * 5000 + 20000;
    console.warn(`   Gas estimation failed: ${error.shortMessage}`);
    console.log(
      `   Using calculated gas limit based on proof size: ${calculatedGas} (${continuityLength} continuity blocks)`,
    );
    gasLimit = BigInt(calculatedGas);
  }

  return gasLimit;
}
