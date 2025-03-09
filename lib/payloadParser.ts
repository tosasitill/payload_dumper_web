import {
  PayloadHeader,
  DeltaArchiveManifest,
  PartitionUpdate,
  Operation,
  OperationType
} from './payloadTypes';

const PAYLOAD_MAGIC = 'CrAU';
const BLOCK_SIZE = 4096;

export class PayloadParser {
  private buffer: ArrayBuffer;
  private view: DataView;
  private offset: number = 0;

  constructor(buffer: ArrayBuffer) {
    this.buffer = buffer;
    this.view = new DataView(buffer);
  }

  private readUint64(): number {
    const low = this.view.getUint32(this.offset, true);
    const high = this.view.getUint32(this.offset + 4, true);
    this.offset += 8;
    // 由于 JavaScript 的数字精度限制，我们只使用低 32 位
    return low;
  }

  public async parse(): Promise<{
    header: PayloadHeader;
    manifest: DeltaArchiveManifest;
  }> {
    const magic = this.readString(4);
    if (magic !== PAYLOAD_MAGIC) {
      throw new Error('Invalid payload magic');
    }

    const version = this.readUint64();
    const manifestSize = this.readUint64();
    const metadataSignatureSize = this.view.getUint32(this.offset, true);
    this.offset += 4;

    // 跳过签名数据
    this.offset += metadataSignatureSize;

    const manifestBytes = new Uint8Array(
      this.buffer.slice(this.offset, this.offset + manifestSize)
    );
    this.offset += manifestSize;

    const manifest = await this.parseManifest(manifestBytes);

    return {
      header: {
        version,
        manifestSize,
        metadataSignatureSize,
        signatures: []
      },
      manifest
    };
  }

  public async extractPartition(
    partitionName: string,
    manifest: DeltaArchiveManifest
  ): Promise<Blob> {
    const partition = manifest.partitions.find(
      p => p.partitionName === partitionName
    );
    if (!partition) {
      throw new Error(`Partition ${partitionName} not found`);
    }

    const chunks: Uint8Array[] = [];
    let currentOffset = 0;

    for (const operation of partition.operations) {
      switch (operation.type) {
        case OperationType.REPLACE: {
          const data = new Uint8Array(
            this.buffer.slice(
              this.offset + operation.dataOffset,
              this.offset + operation.dataOffset + operation.dataLength
            )
          );
          chunks.push(data);
          currentOffset += operation.dataLength;
          break;
        }
        case OperationType.ZERO: {
          const zeros = new Uint8Array(operation.dataLength);
          chunks.push(zeros);
          currentOffset += operation.dataLength;
          break;
        }
        default:
          throw new Error(`Unsupported operation type: ${operation.type}`);
      }
    }

    const blob = new Blob(chunks, { type: 'application/octet-stream' });
    return blob;
  }

  private readString(length: number): string {
    const bytes = new Uint8Array(this.buffer.slice(this.offset, this.offset + length));
    this.offset += length;
    return new TextDecoder().decode(bytes);
  }

  private async parseManifest(bytes: Uint8Array): Promise<DeltaArchiveManifest> {
    // 这里应该使用 protobuf 解析，但为了简化，我们先使用一个模拟的解析
    // 在实际实现中，需要使用 protobuf.js 或类似库来解析
    const manifest: DeltaArchiveManifest = {
      partitions: [],
      minorVersion: 0
    };

    let offset = 0;
    const view = new DataView(bytes.buffer);

    while (offset < bytes.length) {
      const partitionNameLength = view.getUint32(offset, true);
      offset += 4;

      const partitionName = new TextDecoder().decode(
        bytes.slice(offset, offset + partitionNameLength)
      );
      offset += partitionNameLength;

      const numOperations = view.getUint32(offset, true);
      offset += 4;

      const operations: Operation[] = [];
      for (let i = 0; i < numOperations; i++) {
        const type = view.getUint32(offset, true);
        offset += 4;

        const dataOffset = view.getUint32(offset, true);
        offset += 4;
        offset += 4; // 跳过高 32 位

        const dataLength = view.getUint32(offset, true);
        offset += 4;
        offset += 4; // 跳过高 32 位

        operations.push({
          type,
          dataOffset,
          dataLength,
          dstExtents: []
        });
      }

      manifest.partitions.push({
        partitionName,
        operations,
        newPartitionInfo: {
          size: 0,
          hash: new Uint8Array()
        }
      });
    }

    return manifest;
  }
} 