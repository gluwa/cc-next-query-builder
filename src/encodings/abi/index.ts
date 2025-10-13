import { TransactionResponse, TransactionReceipt } from 'ethers';
import { abiEncode as abiEncodeV1 } from './v1';

export enum EncodingVersion {
  V1 = 1,
}

export function abiEncode(
  tx: TransactionResponse,
  rx: TransactionReceipt,
  encoding: EncodingVersion = EncodingVersion.V1,
) {
  switch (encoding) {
    case EncodingVersion.V1:
      return abiEncodeV1(tx, rx);
    default:
      return abiEncodeV1(tx, rx);
  }
}
