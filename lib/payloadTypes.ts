export interface PayloadHeader {
  version: number;
  manifestSize: number;
  metadataSignatureSize: number;
  signatures: Uint8Array[];
}

export interface DeltaArchiveManifest {
  partitions: PartitionUpdate[];
  minorVersion?: number;
  maxTimestamp?: number;
}

export interface PartitionUpdate {
  partitionName: string;
  operations: Operation[];
  newPartitionInfo: PartitionInfo;
}

export interface PartitionInfo {
  size: number;
  hash: Uint8Array;
}

export interface Operation {
  type: OperationType;
  dataOffset: number;
  dataLength: number;
  srcExtents?: Extent[];
  dstExtents: Extent[];
}

export interface Extent {
  startBlock: number;
  numBlocks: number;
}

export enum OperationType {
  REPLACE = 0,
  ZERO = 1,
  COPY = 2,
  BSDIFF = 3,
} 