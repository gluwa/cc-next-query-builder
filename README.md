# Creditcoin's Universal Smart Contract SDK

SDK for JS/TS used for interacting with the Creditcoin network through a variety of tools. To
use it simply add the following package to your dependencies:

```sh
npm install @gluwa/usc-sdk
```

or with yarn

```sh
yarn add @gluwa/usc-sdk
```

## Transaction verification

For verifying transaction inclusion the library has a series of components used to generate and validate inclusion proofs along with helper tools for tracking supported source
chains from which transactions can be proven along with helpers for keeping track of block attestation and supported chain state on the targeted Creditcoin chain.

### Supported chains and attestation information

The `PrecompileChainInfoProvider` interacts with Creditcoin's ChainInfo precompile contract to retrieve information about supported chains, attestation data, and continuity bounds. This component is essential for understanding the current state of cross-chain attestations.

```js
import { chainInfo } from '@gluwa/usc-sdk';
import { JsonRpcProvider } from 'ethers';

const provider = new JsonRpcProvider('https://rpc.usc-testnet2.creditcoin.network');
const chainInfoProvider = new chainInfo.PrecompileChainInfoProvider(provider);

// Get supported chains
const supportedChains = await chainInfoProvider.getSupportedChains();
console.log('Supported chains:', supportedChains);

// Get continuity bounds for a specific block
const bounds = await chainInfoProvider.getContinuityBounds(chainKey, blockHeight);
console.log('Continuity bounds:', bounds);

// Wait for a block to be attested
await chainInfoProvider.waitUntilHeightAttested(chainKey, targetHeight);
```

### Proof generation

The `ProverAPIProofGenerator` provides a convenient way to generate proofs by communicating with remote proof generation API servers. This component handles HTTP communication and provides a clean interface for fetching pre-computed proofs.

```js
import { proofGenerator } from '@gluwa/usc-sdk';

const chainKey = 2; // Example supported chain key
const apiServerUrl = 'https://proof-gen-api.usc-testnet2.creditcoin.network';
const apiProvider = new proofGenerator.api.ProverAPIProofGenerator(chainKey, apiServerUrl);

const proofResult = await apiProvider.generateProof(transactionHash);
if (proofResult.success) {
  // Use the proof data
  console.log('Proof generated successfully:', proofResult.data);
} else {
  console.error('Proof generation failed:', proofResult.error);
}
```

### Proof validation

The `PrecompileBlockProver` provides on-chain verification capabilities for transaction proofs. It can verify both single transactions and batches of transactions using Merkle proofs and continuity proofs.

```js
import { blockProver } from '@gluwa/usc-sdk';
import { JsonRpcProvider } from 'ethers';

const provider = new JsonRpcProvider('https://rpc.usc-testnet2.creditcoin.network');
const prover = new blockProver.PrecompileBlockProver(provider);

// Verify a single transaction proof
const verificationResult = await prover.verifySingle(
  chainKey,
  blockHeight,
  encodedTransactionBytes,
  merkleProof,
  continuityProof,
  true, // emit event on successful verification
);

if (verificationResult) {
  console.log('Transaction proof verified successfully');
} else {
  console.log('Transaction proof verification failed');
}

// Verify multiple transactions with a shared continuity proof
const batchResult = await prover.verifyBatch(
  ,
  [height1, height2, height3],
  [txBytes1, txBytes2, txBytes3],
  [merkleProof1, merkleProof2, merkleProof3],
  sharedContinuityProof,
  true,
);
```

### Complete end to end example

Here's an example showing how to use the proof generator components together:

```js
import { chainInfo, blockProver, proofGenerator } from '@gluwa/usc-sdk';
import { JsonRpcProvider } from 'ethers';

const chainKey = 1;

// Setup Creditcoin components
const creditcoinProvider = new JsonRpcProvider('https://rpc.usc-testnet2.creditcoin.network');
const chainInfoProvider = new chainInfo.PrecompileChainInfoProvider(creditcoinProvider);
const prover = new blockProver.PrecompileBlockProver(creditcoinProvider);

// Generate proof via API

const sourceChainProvider = new JsonRpcProvider('https://sepolia.infura.io/v3/<api_key>');
const txHash = '0x6fe777442b70a5511f3c443176ae860e50445bd93b663711717996a70c5022ab'; // Example transaction hash
const txHeight = await sourceChainProvider.getTransaction(txHash).then((tx) => tx?.blockNumber);

// Before generating a proof we have to wait for the block containing the transaction
// we want to prove, to be attested on the creditcoin chain
await chainInfoProvider.waitUntilHeightAttested(chainKey, txHeight);

// Once the block is attested we can request the proof from the API server
const apiProvider = new proofGenerator.api.ProverAPIProofGenerator(
  chainKey,
  'https://proof-gen-api.usc-testnet2.creditcoin.network',
);
const proofResult = await apiProvider.generateProof(txHash);

if (proofResult.success && proofResult.data) {
  const proofData = proofResult.data;

  // Verify the proof on-chain
  const verificationResult = await prover.verifySingle(
    proofData.chainKey,
    proofData.headerNumber,
    proofData.txBytes,
    proofData.merkleProof,
    proofData.continuityProof,
    true,
  );

  console.log('Proof verification:', verificationResult ? 'SUCCESS' : 'FAILED');
}
```

## Query Builder

The `QueryBuilder` is used to extract result segments from transactions which can be used to validate their contents. To use it follow the example below:

Get the ethers transaction and transaction receipt objects for the transaction from which you want to compose the query.

```js
import { queryBuilder, encoding } from '@gluwa/usc-sdk';
import { JsonRpcProvider } from 'ethers';

const provider = new JsonRpcProvider('https://sepolia.infura.io/v3/<api_key>');
const transactionHash = '0x6fe777442b70a5511f3c443176ae860e50445bd93b663711717996a70c5022ab';
const transaction = await provider.getTransaction(transactionHash);
const receipt = await provider.getTransactionReceipt(transactionHash);
const encoding = encoding.EncodingVersion.V1;
const builder = queryBuilder.QueryBuilder.createFromTransaction(transaction!, receipt!, encoding);
```

### Setting an ABI provider to decode the calldata and events

Contract-specific fields like calldata and events require the ABI from the respective contracts in order for the query builder to understand the context of the data. The ABI provider that the query builder needs is essentially a function that receives the contract address and outputs the ABI of that contract address.

```js
builder.setAbiProvider(async (contractAddress: string) => {
  return JSON.stringify(erc20Abi);
});
```

### Building the query

Depending on what your Universal Smart Contract on USC testnet requires, you can configure your query builder to add fields from the transaction where the available fields are

```js
export enum QueryableFields {
  Type = 'type',
  TxChainId = 'chainId',
  TxNonce = 'nonce',
  TxGasPrice = 'gasPrice',
  TxGasLimit = 'gasLimit',
  TxFrom = 'from',
  TxTo = 'to',
  TxValue = 'value',
  TxData = 'data',
  TxV = 'v',
  TxR = 'r',
  TxS = 's',
  TxYParity = 'yParity',
  TxAccessList = 'accessList',
  TxMaxPriorityFeePerGas = 'maxPriorityFeePerGas',
  TxMaxFeePerGas = 'maxFeePerGas',
  TxMaxFeePerBlobGas = 'maxFeePerBlobGas',
  TxBlobVersionedHashes = 'blobVersionedHashes',
  RxStatus = 'rxStatus',
  RxGasUsed = 'rxGasUsed',
  RxLogBlooms = 'rxLogBlooms',
  RxLogs = 'rxLogs',
}
```

Example

```js
builder
  .addStaticField(QueryableFields.RxStatus)
  .addStaticField(QueryableFields.TxFrom)
  .addStaticField(QueryableFields.TxTo);
```

To add calldata-specific fields, you'll need to use the query builder's add function argument. Please make sure that the contract's address for the calldata is available in the abi provider you've set for the query builder.
Example, we want to include the to and value of a ERC20 transfer calldata

```js
builder.setAbiProvider(async (contractAddress) => {
  return `[
    {
      'constant': false,
      'inputs': [
          {
              'name': 'to',
              'type': 'address'
          },
          {
              'name': 'value',
              'type': 'uint256'
          }
      ],
      'name': 'transfer',
      'outputs': [
          {
              'name': '',
              'type': 'bool'
          }
      ],
      'payable': false,
      'stateMutability': 'nonpayable',
      'type': 'function'
    }
  ]`;
});

builder.addFunctionSignature();
await builder.addFunctionArgument('Transfer', 'to');
await builder.addFunctionArgument('Transfer', 'value');
```

To add event-specific fields, you'll need to use the query builder's eventBuilder.
Please make sure that the contract's address from where the event was emitted is available in the abi provider you've set for the query builder.
Example, we want to build a query for an ERC20 Transfer event

```js
import {Log, LogDescription} from 'ethers';

builder.setAbiProvider(async (contractAddress) => {
  return `[
    {
      'anonymous': false,
      'inputs': [
          {
              'indexed': true,
              'name': 'from',
              'type': 'address'
          },
          {
              'indexed': true,
              'name': 'to',
              'type': 'address'
          },
          {
              'indexed': false,
              'name': 'value',
              'type': 'uint256'
          }
      ],
      'name': 'Transfer',
      'type': 'event'
    }
  ]`;
})
// This is optional that you can further filter for events you're interested in
// If you don't want to filter, just provide a function that only returns true
const burnTransferFilter = (log: Log, logDescription: LogDescription, _: number) => {
  if (logDescription.topic != '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef')
      return false;

  if (log.address.toLowerCase() != '0x47C30768E4c153B40d55b90F58472bb2291971e6'.toLowerCase())
      return false;

  return logDescription.args.from.toLowerCase() == '0x9d6bC9763008AD1F7619a3498EfFE9Ec671b276D'.toLowerCase() && logDescription.args.to.toLowerCase() == ZeroAddress.toLowerCase();
};
await builder.eventBuilder('Transfer', burnTransferFilter, b => b
  .addSignature().addArgument('from').addArgument('to').addArgument('value')
);
```
