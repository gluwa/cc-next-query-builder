# cc-next-query-builder
cc-next-query-builder is a SDK for JS/TS used for composing layout segments within a query to be submitted to the CCNext prover contract.

# How to use?

## 0. Prerequisite
This SDK requires ethers v6

## 1. Install the SDK to your JS/TS project
``` sh
npm install @gluwa/cc-next-query-builder
```
or with yarn
``` sh
yarn add @gluwa/cc-next-query-builder
```

## 2. Preparing your transactions for query building
Get the ethers' transation and transaction receipt objects for the transactions from where you want to compose the query.
``` js
const rpc = "your source chain rpc";
const provider = new JsonRpcProvider(rpc);
const transactionHash = "your transaction hash on the source chain";
const transaction = await provider.getTransaction(transactionHash);
const receipt = await provider.getTransactionReceipt(transactionHash);
const builder = QueryBuilder.createFromTransaction(transaction!, receipt!);
```

## 3. Setting an ABI provider to decode the calldata and events
Contract specific fields like calldata and events required the ABI from respective contracts in order for the query builder to understand the context of the data. The ABI provider that the query builder needs is essentially a function that receives the contract address and outputs the ABI of that contract address.

``` js
builder.setAbiProvider(async (contractAddress: string) => {
  return JSON.stringify(erc20Abi);
});
```

## 4. Building the query
Depending on what your USC on CCNext requires, you can configure your query builder to add fields from the transaction where the available fields are 
``` js
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
``` js
builder
  .addStaticField(QueryableFields.RxStatus)
  .addStaticField(QueryableFields.TxFrom)
  .addStaticField(QueryableFields.TxTo);
```
To add fields specific from the calldata, you'll need to use the query builder's add function argument. Please make sure that the contract's address for the calldata is available in the abi provider you've set for the query builder.
Example, we want to include the to and value of a ERC20 transfer calldata
``` js
builder.setAbiProvider(async (contractAddress) => {
  return `[
    {
      "constant": false,
      "inputs": [
          {
              "name": "to",
              "type": "address"
          },
          {
              "name": "value",
              "type": "uint256"
          }
      ],
      "name": "transfer",
      "outputs": [
          {
              "name": "",
              "type": "bool"
          }
      ],
      "payable": false,
      "stateMutability": "nonpayable",
      "type": "function"
    }
  ]`;
})

builder.addFunctionSignature();
await builder.addFunctionArgument("Transfer", "to");
await builder.addFunctionArgument("Transfer", "value");
```
To add fields specific for the event, you'll need to use the query builder's eventBuilder.
Please make sure that the contract's address from where the event was emitted is available in the abi provider you've set for the query builder.
Example, we want to build a query for an ERC20 Transfer event

``` js
import {Log, LogDescription } from 'ethers';
...
builder.setAbiProvider(async (contractAddress) => {
  return `[
    {
      "anonymous": false,
      "inputs": [
          {
              "indexed": true,
              "name": "from",
              "type": "address"
          },
          {
              "indexed": true,
              "name": "to",
              "type": "address"
          },
          {
              "indexed": false,
              "name": "value",
              "type": "uint256"
          }
      ],
      "name": "Transfer",
      "type": "event"
    }
  ]`;
})
// This is optional that you can further filter for events you're interested in
// If you don't want to filter, just provide a function that only returns true
const burnTransferFilter = (log: Log, logDescription: LogDescription, _: number) => {
  if (logDescription.topic != "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef")
      return false;

  if (log.address.toLowerCase() != "0x47C30768E4c153B40d55b90F58472bb2291971e6".toLowerCase())
      return false;

  return logDescription.args.from.toLowerCase() == "0x9d6bC9763008AD1F7619a3498EfFE9Ec671b276D".toLowerCase() && logDescription.args.to.toLowerCase() == ZeroAddress.toLowerCase();
};
await builder.eventBuilder("Transfer", burnTransferFilter, b => b
  .addSignature().addArgument("from").addArgument("to").addArgument("value")
);
```

## 5. Submit the query
Now that you have your layout segments, you'll need to complete the query based on the Prover's ABI. Please refer to the bridge examples for more details
