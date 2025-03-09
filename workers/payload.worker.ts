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
  const response = await fetch(url)
  const arrayBuffer = await response.arrayBuffer()
  await processPayloadBuffer(arrayBuffer, partitions)
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