import { blockProver, proofGenerator, utils } from '@gluwa/usc-sdk';
import { JsonRpcProvider } from 'ethers';

async function example(): Promise<void> {
  // IMPORTANT: You have to define these values before executing this example
  const apiServerUrl = utils.env.getEnv('CREDITCOIN_PROOF_GEN_URL');
  const creditcoinRpcUrl = utils.env.getEnv('CREDITCOIN_RPC_URL');
  const chainKey = parseInt(utils.env.getEnv('SOURCE_CHAIN_KEY'));
  const transactionHash = utils.env.getEnv('SOURCE_CHAIN_TXN_HASH');

  // First generate proof which we can validate later
  const apiProvider = new proofGenerator.api.ProverAPIProofGenerator(chainKey, apiServerUrl);
  const proofResult = await apiProvider.generateProof(transactionHash);

  // verify the proof only if generated successfully
  if (proofResult.success && proofResult.data) {
    console.log('Proof generated successfully:', proofResult.data);
    const proofData = proofResult.data;

    const provider = new JsonRpcProvider(creditcoinRpcUrl);
    const prover = new blockProver.PrecompileBlockProver(provider);

    // Verify the proof on-chain
    const verificationResult = await prover.verifySingle(
      proofData.chainKey,
      proofData.headerNumber,
      proofData.txBytes,
      proofData.merkleProof,
      proofData.continuityProof,
    );

    console.log('Proof verification:', verificationResult ? 'SUCCESS' : 'FAILED');
    if (!verificationResult) {
      throw new Error('proof verification failed');
    }
  } else {
    throw new Error(`Proof generation failed: ${proofResult.error}`);
  }

  // Verify multiple transactions with a shared continuity proof
  //  const batchResult = await prover.verifyBatch(
  //    ,
  //    [height1, height2, height3],
  //    [txBytes1, txBytes2, txBytes3],
  //    [merkleProof1, merkleProof2, merkleProof3],
  //    sharedContinuityProof,
  //    true,
  //  );
}

example().catch((reason) => {
  console.error(reason);
  process.exit(1);
});
