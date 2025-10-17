import { MappedEncodedFields } from '../models';
import { EncodingVersion } from '../../../encodings/abi';
import {
  getMappedFieldsForType as getMappedFieldsForTypeV1,
  getMappedReceiptFields as getMappedReceiptFieldsV1,
} from './v1';

export function getAllFieldsForTransaction(type: number, encoding: EncodingVersion): MappedEncodedFields {
  let txFields = null;
  let rxFields = null;
  switch (encoding) {
    case EncodingVersion.V1:
      txFields = getMappedFieldsForTypeV1(type);
      rxFields = getMappedReceiptFieldsV1();
      break;
    default:
      txFields = getMappedFieldsForTypeV1(type);
      rxFields = getMappedReceiptFieldsV1();
      break;
  }
  const allFields: MappedEncodedFields = {
    fields: [...txFields.fields, ...rxFields.fields],
  };

  return allFields;
}
