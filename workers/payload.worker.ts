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

// 下载指定范围的数据，支持分块下载
async function downloadRange(url: string, start: number, end: number, maxChunkSize: number = 5 * 1024 * 1024): Promise<ArrayBuffer> {
  // 安全检查
  if (start < 0 || end < start || end > Number.MAX_SAFE_INTEGER) {
    throw new Error(`Invalid range: ${start}-${end}`);
  }

  const totalSize = end - start + 1;
  console.log(`Downloading range: bytes=${start}-${end} (${totalSize} bytes)`);

  // 如果大小小于最大块大小，直接下载
  if (totalSize <= maxChunkSize) {
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

    return response.arrayBuffer();
  }

  // 分块下载
  const chunks: ArrayBuffer[] = [];
  let currentStart = start;
  let retryCount = 0;
  const maxRetries = 3;

  while (currentStart <= end) {
    const chunkEnd = Math.min(currentStart + maxChunkSize - 1, end);
    console.log(`Downloading chunk: bytes=${currentStart}-${chunkEnd}`);

    try {
      const response = await fetch(url, {
        headers: {
          'Range': `bytes=${currentStart}-${chunkEnd}`,
          'Accept': '*/*',
        }
      });

      if (!response.ok && response.status !== 206) {
        throw new Error(`Failed to fetch chunk: ${response.status} ${response.statusText}`);
      }

      const chunk = await response.arrayBuffer();
      chunks.push(chunk);
      currentStart = chunkEnd + 1;
      retryCount = 0; // 重置重试计数
    } catch (error: unknown) {
      console.error(`Error downloading chunk ${currentStart}-${chunkEnd}:`, error);
      retryCount++;
      
      if (retryCount >= maxRetries) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to download chunk after ${maxRetries} retries: ${errorMessage}`);
      }
      
      // 等待一段时间后重试
      await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
      continue; // 重试当前块
    }
  }

  // 合并所有块
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }

  return result.buffer;
}

// 读取 ZIP 文件中的 payload.bin
async function readZipPayload(url: string): Promise<{ buffer: ArrayBuffer; offset: number }> {
  // 首先读取 ZIP 文件末尾以查找中央目录
  const response = await fetch(url, {
    headers: {
      'Range': 'bytes=-65536', // 读取最后 64KB，应该足够包含中央目录
      'Accept': '*/*',
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ZIP end: ${response.status} ${response.statusText}`);
  }

  const endBuffer = await response.arrayBuffer();
  const endView = new DataView(endBuffer);
  
  // 从末尾开始查找中央目录结束标记 (0x06054b50)
  let eocdOffset = -1;
  for (let i = endBuffer.byteLength - 22; i >= 0; i--) {
    if (endView.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error('ZIP central directory end marker not found');
  }

  // 读取中央目录偏移量
  const cdOffset = endView.getUint32(eocdOffset + 16, true);
  const cdSize = endView.getUint32(eocdOffset + 12, true);
  const totalEntries = endView.getUint16(eocdOffset + 10, true);
  
  console.log('ZIP central directory info:', {
    offset: cdOffset,
    size: cdSize,
    entries: totalEntries
  });
  
  // 读取中央目录
  const cdResponse = await fetch(url, {
    headers: {
      'Range': `bytes=${cdOffset}-${cdOffset + cdSize - 1}`,
      'Accept': '*/*',
    }
  });

  if (!cdResponse.ok) {
    throw new Error(`Failed to fetch ZIP central directory: ${cdResponse.status} ${cdResponse.statusText}`);
  }

  const cdBuffer = await cdResponse.arrayBuffer();
  const cdView = new DataView(cdBuffer);
  let offset = 0;
  const possibleNames = ['payload.bin', 'PAYLOAD.BIN', 'payload.img', 'PAYLOAD.IMG'];

  // 遍历中央目录寻找 payload.bin
  while (offset < cdBuffer.byteLength) {
    const signature = cdView.getUint32(offset, true);
    if (signature !== 0x02014b50) { // 中央目录文件头标记
      console.log('Reached end of central directory at offset:', offset);
      break;
    }

    const fileNameLength = cdView.getUint16(offset + 28, true);
    const extraFieldLength = cdView.getUint16(offset + 30, true);
    const fileCommentLength = cdView.getUint16(offset + 32, true);
    const localHeaderOffset = cdView.getUint32(offset + 42, true);
    const compressionMethod = cdView.getUint16(offset + 10, true);
    
    // 读取文件名
    const fileNameBytes = new Uint8Array(cdBuffer, offset + 46, fileNameLength);
    const fileName = new TextDecoder().decode(fileNameBytes);
    
    console.log('Found file in ZIP:', {
      name: fileName,
      compression: compressionMethod,
      offset: localHeaderOffset
    });

    // 检查是否是我们要找的文件
    const isPayloadFile = possibleNames.some(name => 
      fileName.toLowerCase().endsWith(name.toLowerCase())
    );

    if (isPayloadFile) {
      console.log('Found potential payload file:', fileName);
      
      if (compressionMethod !== 0) {
        console.log('File is compressed, trying next file...');
        offset += 46 + fileNameLength + extraFieldLength + fileCommentLength;
        continue;
      }

      // 读取本地文件头
      const headerResponse = await fetch(url, {
        headers: {
          'Range': `bytes=${localHeaderOffset}-${localHeaderOffset + 1024}`,
          'Accept': '*/*',
        }
      });

      if (!headerResponse.ok) {
        throw new Error(`Failed to fetch local file header: ${headerResponse.status} ${headerResponse.statusText}`);
      }

      const headerBuffer = await headerResponse.arrayBuffer();
      const headerView = new DataView(headerBuffer);

      // 验证本地文件头签名
      if (headerView.getUint32(0, true) !== 0x04034b50) {
        throw new Error('Invalid local file header signature');
      }

      const localFileNameLength = headerView.getUint16(26, true);
      const localExtraFieldLength = headerView.getUint16(28, true);

      // 计算文件数据的实际起始位置
      const fileDataOffset = localHeaderOffset + 30 + localFileNameLength + localExtraFieldLength;
      
      // 验证文件头部是否为 payload 格式
      const payloadHeaderResponse = await fetch(url, {
        headers: {
          'Range': `bytes=${fileDataOffset}-${fileDataOffset + 7}`,
          'Accept': '*/*',
        }
      });

      if (!payloadHeaderResponse.ok) {
        console.log('Failed to read payload header, trying next file...');
        offset += 46 + fileNameLength + extraFieldLength + fileCommentLength;
        continue;
      }

      const payloadHeaderBuffer = await payloadHeaderResponse.arrayBuffer();
      const payloadHeaderView = new DataView(payloadHeaderBuffer);
      const payloadMagic = payloadHeaderView.getUint32(0, true);

      if (payloadMagic === 0xed26ff3a) {
        console.log('Found valid payload file at offset:', fileDataOffset);
        return {
          offset: fileDataOffset,
          buffer: new ArrayBuffer(0) // 占位符
        };
      } else {
        console.log('Invalid payload magic number, trying next file...');
      }
    }

    offset += 46 + fileNameLength + extraFieldLength + fileCommentLength;
  }

  throw new Error('No valid payload file found in ZIP central directory');
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
    let zipOffset = 0;

    if (magic === 0x04034b50) { // ZIP 文件
      console.log('Detected ZIP file, locating payload.bin...');
      const zipInfo = await readZipPayload(url);
      zipOffset = zipInfo.offset;
      
      // 只读取 payload.bin 的头部
      const headerResponse = await fetch(url, {
        headers: {
          'Range': `bytes=${zipOffset}-${zipOffset + 8191}`,
          'Accept': '*/*',
        }
      });

      if (!headerResponse.ok) {
        throw new Error(`Failed to fetch payload header: ${headerResponse.status} ${headerResponse.statusText}`);
      }

      payloadBuffer = await headerResponse.arrayBuffer();
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
      
      // 如果是 ZIP 文件，需要加上 payload.bin 在 ZIP 中的偏移量
      const finalOffset = zipOffset + partitionOffset;
      manifest.push({ name, size, offset: finalOffset });
      console.log(`Found partition: ${name} (size: ${size}, offset: ${finalOffset})`);
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
    // 首先尝试检测文件类型
    console.log('Detecting file type...');
    const typeResponse = await fetch(finalUrl, {
      headers: {
        'Range': 'bytes=0-3',
        'Accept': '*/*',
      }
    });

    if (!typeResponse.ok) {
      throw new Error(`Failed to detect file type: ${typeResponse.status} ${typeResponse.statusText}`);
    }

    const magicBuffer = await typeResponse.arrayBuffer();
    const magicView = new DataView(magicBuffer);
    const magic = magicView.getUint32(0, true);
    
    console.log('File magic number:', magic.toString(16));
    
    let payloadOffset = 0;
    if (magic === 0x04034b50) {
      console.log('Detected ZIP file format');
      const zipInfo = await readZipPayload(finalUrl);
      payloadOffset = zipInfo.offset;
      console.log('Found payload.bin at offset:', payloadOffset);
    } else if (magic === 0xed26ff3a) {
      console.log('Detected direct payload.bin format');
    } else {
      throw new Error(`Unknown file format: ${magic.toString(16)}`);
    }

    // 读取 payload 头部
    console.log('Reading payload header from offset:', payloadOffset);
    const headerResponse = await fetch(finalUrl, {
      headers: {
        'Range': `bytes=${payloadOffset}-${payloadOffset + 8191}`,
        'Accept': '*/*',
      }
    });

    if (!headerResponse.ok) {
      throw new Error(`Failed to read payload header: ${headerResponse.status} ${headerResponse.statusText}`);
    }

    const headerBuffer = await headerResponse.arrayBuffer();
    const headerView = new DataView(headerBuffer);
    
    // 验证 payload 魔数
    const payloadMagic = headerView.getUint32(0, true);
    console.log('Payload magic number:', payloadMagic.toString(16));
    
    if (payloadMagic !== 0xed26ff3a) {
      throw new Error(`Invalid payload magic number: ${payloadMagic.toString(16)}`);
    }

    // 继续处理 payload 头部
    const header = await readPayloadHeader(finalUrl);
    console.log('Successfully parsed payload header:', JSON.stringify(header, null, 2));

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