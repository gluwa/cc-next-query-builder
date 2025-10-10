import { MappedEncodedFields, QueryableFields } from '../models';
import { EncodingVersion } from '../../../encodings/abi';
import { getMappedFieldsForType as getMappedFieldsForTypeV1 } from './v1';

function getMappedReceiptFields(): MappedEncodedFields {
  return {
    fields: [
      { name: QueryableFields.RxStatus, type: 'uint8' },
      { name: QueryableFields.RxGasUsed, type: 'uint64' },
      { name: QueryableFields.RxLogs, type: 'tuple(address, bytes32[], bytes)[]' },
      { name: QueryableFields.RxLogBlooms, type: 'bytes' },
    ],
  };
}

export function getAllFieldsForTransaction(type: number, encoding: EncodingVersion): MappedEncodedFields {
  let txFields = null;
  switch (encoding) {
    case EncodingVersion.V1:
      txFields = getMappedFieldsForTypeV1(type);
      break;
    default:
      txFields = getMappedFieldsForTypeV1(type);
      break;
  }
  const rxFields = getMappedReceiptFields();
  const allFields: MappedEncodedFields = {
    fields: [...txFields.fields, ...rxFields.fields],
  };

  return allFields;
}
