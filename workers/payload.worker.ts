/// <reference lib="webworker" />

import type { PayloadInfo } from '../lib/payloadHandler'
import { PayloadParser } from '../lib/payloadParser'

declare const self: DedicatedWorkerGlobalScope

type WorkerMessage = {
  type: 'process';
  payload: PayloadInfo;
}

type WorkerResponse = {
  type: 'success' | 'error' | 'progress';
  error?: string;
  progress?: {
    partition: string;
    url: string;
  };
}

type PayloadHeader = {
  version: number;
  manifest: {
    name: string;
    size: number;
    offset: number;
  }[];
}

console.log('Worker script loaded');

// 获取当前域名
const getBaseUrl = () => {
  try {
    // 尝试从 self.location 获取基础 URL
    if (typeof self !== 'undefined' && self.location) {
      const url = new URL(self.location.href);
      // 如果是 blob URL，需要解析实际的源
      if (url.protocol === 'blob:') {
        const actualUrl = url.pathname; // blob: URL 的 pathname 是实际的 URL
        return new URL(actualUrl).origin;
      }
      return `${url.protocol}//${url.host}`;
    }
    
    // 如果在开发环境，使用默认值
    if (process.env.NODE_ENV === 'development') {
      return 'http://localhost:3000';
    }
    
    // 如果在生产环境，使用 Vercel URL
    if (process.env.VERCEL_URL) {
      return `https://${process.env.VERCEL_URL}`;
    }
    
    throw new Error('Unable to determine base URL');
  } catch (error: unknown) {
    console.error('Failed to get base URL:', error);
    // 返回一个默认值而不是空字符串
    return 'https://payload-dumper.vercel.app';
  }
};

// 读取 ZIP 文件中的 payload.bin
async function readZipPayload(url: string): Promise<ArrayBuffer> {
  // 首先读取 ZIP 文件头部来定位 payload.bin
  const response = await fetch(url, {
    headers: {
      'Range': 'bytes=0-16384', // 读取前 16KB，应该足够包含 ZIP 头部
      'Accept': '*/*',
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ZIP header: ${response.status} ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  const view = new DataView(buffer);
  let offset = 0;

  while (offset < buffer.byteLength - 4) {
    const signature = view.getUint32(offset, true);
    if (signature === 0x04034b50) { // ZIP 文件头签名
      // 读取文件名长度
      const fileNameLength = view.getUint16(offset + 26, true);
      // 读取扩展字段长度
      const extraFieldLength = view.getUint16(offset + 28, true);
      // 读取压缩数据大小
      const compressedSize = view.getUint32(offset + 18, true);
      // 读取文件名
      const fileNameBytes = new Uint8Array(buffer, offset + 30, fileNameLength);
      const fileName = new TextDecoder().decode(fileNameBytes);

      console.log('Found file in ZIP:', {
        fileName,
        compressedSize,
        offset: offset + 30 + fileNameLength + extraFieldLength
      });

      if (fileName === 'payload.bin') {
        // 找到了 payload.bin，现在下载完整的文件
        const fileStart = offset + 30 + fileNameLength + extraFieldLength;
        const fileData = await downloadRange(url, fileStart, fileStart + compressedSize - 1);
        
        // 检查是否需要解压
        const compressionMethod = view.getUint16(offset + 8, true);
        if (compressionMethod === 0) { // 0 = 未压缩
          return fileData;
        } else {
          throw new Error('Compressed payload.bin is not supported yet');
        }
      }

      // 移动到下一个文件头
      offset += 30 + fileNameLength + extraFieldLength + compressedSize;
    } else {
      offset++;
    }
  }

  throw new Error('payload.bin not found in ZIP file');
}

// 读取 payload.bin 头部信息
async function readPayloadHeader(url: string): Promise<PayloadHeader> {
  try {
    // 首先尝试直接读取 payload.bin
    const response = await fetch(url, {
      headers: {
        'Range': 'bytes=0-3',
        'Accept': '*/*',
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch header: ${response.status} ${response.statusText}`);
    }

    const magicBuffer = await response.arrayBuffer();
    const magicView = new DataView(magicBuffer);
    const magic = magicView.getUint32(0, true);

    let payloadBuffer: ArrayBuffer;
    if (magic === 0x04034b50) { // ZIP 文件
      console.log('Detected ZIP file, extracting payload.bin...');
      payloadBuffer = await readZipPayload(url);
    } else {
      // 直接读取前 8KB
      const fullResponse = await fetch(url, {
        headers: {
          'Range': 'bytes=0-8191',
          'Accept': '*/*',
        }
      });

      if (!fullResponse.ok) {
        throw new Error(`Failed to fetch payload: ${fullResponse.status} ${fullResponse.statusText}`);
      }

      payloadBuffer = await fullResponse.arrayBuffer();
    }

    if (payloadBuffer.byteLength < 8) {
      throw new Error('Invalid payload header: too small');
    }

    const view = new DataView(payloadBuffer);
    
    // 读取魔数（前 4 个字节）
    const payloadMagic = view.getUint32(0, true);
    if (payloadMagic !== 0xed26ff3a) { // PAYLOAD_MAGIC
      throw new Error(`Invalid payload magic number: ${payloadMagic.toString(16)}`);
    }

    // 读取版本号（接下来的 4 个字节）
    const version = view.getUint32(4, true);
    if (version !== 2) { // PAYLOAD_VERSION=2
      throw new Error(`Unsupported version: ${version}`);
    }

    // 读取头部大小（接下来的 8 个字节）
    const headerSize = Number(view.getBigUint64(8, true));
    if (headerSize <= 0 || headerSize > payloadBuffer.byteLength) {
      throw new Error(`Invalid header size: ${headerSize}`);
    }

    // 读取清单条目数量（接下来的 4 个字节）
    const manifestCount = view.getUint32(16, true);
    console.log('Manifest count:', manifestCount);
    
    // 安全检查
    if (manifestCount <= 0 || manifestCount > 100) {
      throw new Error(`Invalid manifest count: ${manifestCount}`);
    }
    
    const manifest = [];
    let offset = 20; // 从第 20 个字节开始读取清单
    
    for (let i = 0; i < manifestCount && offset + 4 <= payloadBuffer.byteLength; i++) {
      // 读取分区名长度
      const nameLength = view.getUint32(offset, true);
      offset += 4;
      
      // 安全检查
      if (nameLength <= 0 || nameLength > 256 || offset + nameLength > payloadBuffer.byteLength) {
        throw new Error(`Invalid name length at entry ${i}: ${nameLength}`);
      }
      
      // 读取分区名
      const nameBytes = new Uint8Array(payloadBuffer, offset, nameLength);
      const name = new TextDecoder().decode(nameBytes);
      offset += nameLength;
      
      // 安全检查
      if (offset + 24 > payloadBuffer.byteLength) { // 8 bytes for size + 8 bytes for offset + 8 bytes for padding
        throw new Error(`Buffer overflow at entry ${i}`);
      }
      
      // 读取分区大小和偏移
      const size = Number(view.getBigUint64(offset, true));
      offset += 8;
      const partitionOffset = Number(view.getBigUint64(offset, true));
      offset += 8;
      
      // 跳过额外的 8 字节（可能是对齐或其他数据）
      offset += 8;
      
      // 安全检查
      if (size <= 0 || size > Number.MAX_SAFE_INTEGER) {
        throw new Error(`Invalid partition size at entry ${i}: ${size}`);
      }
      if (partitionOffset < 0 || partitionOffset > Number.MAX_SAFE_INTEGER) {
        throw new Error(`Invalid partition offset at entry ${i}: ${partitionOffset}`);
      }
      
      manifest.push({ name, size, offset: partitionOffset });
      console.log(`Found partition: ${name} (size: ${size}, offset: ${partitionOffset})`);
    }
    
    if (manifest.length === 0) {
      throw new Error('No valid partitions found in manifest');
    }
    
    return { version, manifest };
  } catch (error: unknown) {
    console.error('Failed to parse payload header:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse payload header: ${errorMessage}`);
  }
}

// 下载指定范围的数据
async function downloadRange(url: string, start: number, end: number): Promise<ArrayBuffer> {
  // 安全检查
  if (start < 0 || end < start || end > Number.MAX_SAFE_INTEGER) {
    throw new Error(`Invalid range: ${start}-${end}`);
  }

  console.log(`Downloading range: bytes=${start}-${end}`);
  const response = await fetch(url, {
    headers: {
      'Range': `bytes=${start}-${end}`,
      'Accept': '*/*',
    }
  });

  if (!response.ok && response.status !== 206) {
    const errorText = await response.text();
    console.error('Range request failed:', {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      error: errorText
    });
    throw new Error(`Failed to fetch range: ${response.status} ${response.statusText}\n${errorText}`);
  }

  const contentRange = response.headers.get('Content-Range');
  const contentLength = response.headers.get('Content-Length');
  console.log('Range response headers:', {
    'Content-Range': contentRange,
    'Content-Length': contentLength
  });

  const buffer = await response.arrayBuffer();
  const expectedSize = end - start + 1;
  if (buffer.byteLength !== expectedSize) {
    console.warn('Range size mismatch:', {
      expected: expectedSize,
      received: buffer.byteLength,
      start,
      end,
      contentLength,
      contentRange
    });
  }

  return buffer;
}

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  console.log('Worker received message:', e.data);
  if (e.data.type === 'process') {
    try {
      const { payload } = e.data
      console.log('Processing payload in worker:', payload);
      
      if (payload.type === 'file') {
        await processFile(payload.source as File, payload.partitions)
      } else {
        await processUrl(payload.source as string, payload.partitions)
      }
      
      console.log('Processing completed successfully');
      self.postMessage({ type: 'success' } as WorkerResponse)
    } catch (error: unknown) {
      console.error('Worker error:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      self.postMessage({
        type: 'error',
        error: errorMessage
      } as WorkerResponse)
    }
  }
}

async function processFile(file: File, partitions: string[]) {
  console.log('Processing file:', file.name);
  const arrayBuffer = await file.arrayBuffer()
  await processPayloadBuffer(arrayBuffer, partitions)
}

async function processUrl(url: string, partitions: string[]) {
  console.log('Processing URL:', url);
  const baseUrl = getBaseUrl();
  if (!baseUrl) {
    throw new Error('Failed to determine base URL');
  }
  
  // 创建代理 URL
  const proxyUrl = new URL('/api/proxy', baseUrl);
  proxyUrl.searchParams.set('url', url);
  const finalUrl = proxyUrl.toString();
  console.log('Using proxy URL:', finalUrl);
  
  try {
    // 首先读取头部信息
    console.log('Reading payload header...');
    const header = await readPayloadHeader(finalUrl);
    console.log('Payload header:', JSON.stringify(header, null, 2));

    // 为每个请求的分区创建 blob
    for (const partitionName of partitions) {
      try {
        // 查找分区信息
        const partition = header.manifest.find(m => m.name === partitionName);
        if (!partition) {
          console.warn(`Partition ${partitionName} not found in manifest. Available partitions:`, 
            header.manifest.map(m => m.name).join(', '));
          continue;
        }

        console.log(`Downloading partition ${partitionName}:`, {
          size: partition.size,
          offset: partition.offset
        });
        
        // 下载分区数据
        const partitionData = await downloadRange(finalUrl, partition.offset, partition.offset + partition.size - 1);
        
        // 验证下载的数据大小
        if (partitionData.byteLength !== partition.size) {
          console.warn(`Size mismatch for partition ${partitionName}:`, {
            expected: partition.size,
            received: partitionData.byteLength
          });
        }
        
        // 创建 blob
        const blob = new Blob([partitionData], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        console.log(`Created blob URL for partition ${partitionName}:`, url);
        
        // 发送进度消息
        self.postMessage({
          type: 'progress',
          progress: {
            partition: partitionName,
            url
          }
        } as WorkerResponse);
      } catch (error: unknown) {
        console.error(`Failed to process partition ${partitionName}:`, error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to process partition ${partitionName}: ${errorMessage}`);
      }
    }
  } catch (error: unknown) {
    console.error('Fetch error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to fetch: ${errorMessage}`);
  }
}

async function processPayloadBuffer(buffer: ArrayBuffer, partitions: string[]) {
  console.log('Processing buffer of size:', buffer.byteLength);
  const parser = new PayloadParser(buffer)
  const { manifest } = await parser.parse()
  console.log('Parsed manifest:', manifest);

  for (const partitionName of partitions) {
    try {
      console.log('Extracting partition:', partitionName);
      const blob = await parser.extractPartition(partitionName, manifest)
      const url = URL.createObjectURL(blob)
      console.log('Created blob URL for partition:', partitionName);
      
      self.postMessage({
        type: 'progress',
        progress: {
          partition: partitionName,
          url
        }
      } as WorkerResponse)
    } catch (error: unknown) {
      console.error(`Failed to extract partition ${partitionName}:`, error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to extract partition ${partitionName}: ${errorMessage}`);
    }
  }
}