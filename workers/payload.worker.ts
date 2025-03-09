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
  } catch (error) {
    console.error('Failed to get base URL:', error);
    // 返回一个默认值而不是空字符串
    return 'https://payload-dumper.vercel.app';
  }
};

// 读取 payload.bin 头部信息
async function readPayloadHeader(url: string): Promise<PayloadHeader> {
  const response = await fetch(url, {
    headers: {
      'Range': 'bytes=0-4096', // 读取前 4KB，应该足够包含头部信息
      'Accept': '*/*',
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch header: ${response.status} ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  const view = new DataView(buffer);
  
  // 读取版本号（前 4 个字节）
  const version = view.getUint32(0, true);
  
  // 读取清单条目数量（接下来的 4 个字节）
  const manifestCount = view.getUint32(4, true);
  
  const manifest = [];
  let offset = 8; // 从第 8 个字节开始读取清单
  
  for (let i = 0; i < manifestCount; i++) {
    // 读取分区名长度
    const nameLength = view.getUint32(offset, true);
    offset += 4;
    
    // 读取分区名
    const nameBytes = new Uint8Array(buffer, offset, nameLength);
    const name = new TextDecoder().decode(nameBytes);
    offset += nameLength;
    
    // 读取分区大小和偏移
    const size = Number(view.getBigUint64(offset, true));
    offset += 8;
    const partitionOffset = Number(view.getBigUint64(offset + 8, true));
    offset += 16;
    
    manifest.push({ name, size, offset: partitionOffset });
  }
  
  return { version, manifest };
}

// 下载指定范围的数据
async function downloadRange(url: string, start: number, end: number): Promise<ArrayBuffer> {
  const response = await fetch(url, {
    headers: {
      'Range': `bytes=${start}-${end}`,
      'Accept': '*/*',
    }
  });

  if (!response.ok && response.status !== 206) {
    throw new Error(`Failed to fetch range: ${response.status} ${response.statusText}`);
  }

  return response.arrayBuffer();
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
    } catch (error) {
      console.error('Worker error:', error);
      self.postMessage({
        type: 'error',
        error: error instanceof Error ? error.message : String(error)
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
    const header = await readPayloadHeader(finalUrl);
    console.log('Payload header:', header);

    // 为每个请求的分区创建 blob
    for (const partitionName of partitions) {
      try {
        // 查找分区信息
        const partition = header.manifest.find(m => m.name === partitionName);
        if (!partition) {
          throw new Error(`Partition ${partitionName} not found in manifest`);
        }

        console.log(`Downloading partition ${partitionName} (size: ${partition.size}, offset: ${partition.offset})`);
        
        // 下载分区数据
        const partitionData = await downloadRange(finalUrl, partition.offset, partition.offset + partition.size - 1);
        
        // 创建 blob
        const blob = new Blob([partitionData], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        
        // 发送进度消息
        self.postMessage({
          type: 'progress',
          progress: {
            partition: partitionName,
            url
          }
        } as WorkerResponse);
      } catch (error) {
        console.error(`Failed to process partition ${partitionName}:`, error);
      }
    }
  } catch (error) {
    console.error('Fetch error:', error);
    throw error;
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
    } catch (error) {
      console.error(`Failed to extract partition ${partitionName}:`, error)
    }
  }
} 