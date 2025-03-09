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

console.log('Worker script loaded');

// 获取当前域名
const getBaseUrl = () => {
  try {
    const workerLocation = self.location.href;
    const url = new URL(workerLocation);
    return `${url.protocol}//${url.host}`;
  } catch (error) {
    console.error('Failed to get base URL:', error);
    return '';
  }
};

// 分块下载文件
async function downloadInChunks(url: string, chunkSize: number = 10 * 1024 * 1024): Promise<ArrayBuffer> {
  const firstResponse = await fetch(url, {
    headers: { 'Range': 'bytes=0-0' }
  });

  if (!firstResponse.ok && firstResponse.status !== 206) {
    throw new Error(`Failed to fetch: ${firstResponse.status} ${firstResponse.statusText}`);
  }

  const contentRange = firstResponse.headers.get('Content-Range');
  if (!contentRange) {
    // 服务器不支持范围请求，回退到普通下载
    console.log('Server does not support range requests, falling back to normal download');
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
    }
    return response.arrayBuffer();
  }

  const totalSize = parseInt(contentRange.split('/')[1], 10);
  const chunks: ArrayBuffer[] = [];

  for (let start = 0; start < totalSize; start += chunkSize) {
    const end = Math.min(start + chunkSize - 1, totalSize - 1);
    console.log(`Downloading chunk: ${start}-${end}/${totalSize}`);

    const response = await fetch(url, {
      headers: { 'Range': `bytes=${start}-${end}` }
    });

    if (!response.ok && response.status !== 206) {
      throw new Error(`Failed to fetch chunk: ${response.status} ${response.statusText}`);
    }

    const chunk = await response.arrayBuffer();
    chunks.push(chunk);
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
  console.log('Fetching URL:', url);
  const baseUrl = getBaseUrl();
  if (!baseUrl) {
    throw new Error('Failed to determine base URL');
  }
  
  const proxyUrl = `${baseUrl}/api/proxy?url=${encodeURIComponent(url)}`;
  console.log('Using proxy URL:', proxyUrl);
  
  try {
    const arrayBuffer = await downloadInChunks(proxyUrl);
    await processPayloadBuffer(arrayBuffer, partitions);
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