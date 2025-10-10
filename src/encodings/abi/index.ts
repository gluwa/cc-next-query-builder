import { TransactionResponse, TransactionReceipt, AbiCoder } from 'ethers';
import { EncodedFields } from '../common';
import { getFieldsForType as getFieldsForTypeV1 } from './v1';

export enum EncodingVersion {
  V1 = 1,
}

function getReceiptFields(rx: TransactionReceipt): EncodedFields {
  return {
    types: ['uint8', 'uint64', 'tuple(address, bytes32[], bytes)[]', 'bytes'],
    values: [rx.status, rx.gasUsed, rx.logs.map((log) => [log.address, log.topics, log.data]), rx.logsBloom],
  };
}

function getAllFields(tx: TransactionResponse, rx: TransactionReceipt, encoding: EncodingVersion): EncodedFields {
  let txFields = null;
  switch (encoding) {
    case EncodingVersion.V1:
      txFields = getFieldsForTypeV1(tx);
      break;
    default:
      txFields = getFieldsForTypeV1(tx);
      break;
  }
  const receiptFields = getReceiptFields(rx);
  const allFieldTypes = [...txFields.types, ...receiptFields.types];
  const allFieldValues = [...txFields.values, ...receiptFields.values];

  return {
    types: allFieldTypes,
    values: allFieldValues,
  };
}

export function abiEncode(
  tx: TransactionResponse,
  rx: TransactionReceipt,
  encoding: EncodingVersion = EncodingVersion.V1,
) {
  const allFields = getAllFields(tx, rx, encoding);
  const abi = AbiCoder.defaultAbiCoder().encode(allFields.types, allFields.values);
  return {
    types: allFields.types,
    abi,
  };
}
