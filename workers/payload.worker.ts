/// <reference lib="webworker" />

import { PayloadInfo } from '@/lib/payloadHandler'
import { PayloadParser } from '@/lib/payloadParser'

interface WorkerMessage {
  type: 'process';
  payload: PayloadInfo;
}

interface WorkerResponse {
  type: 'success' | 'error' | 'progress';
  error?: string;
  progress?: {
    partition: string;
    url: string;
  };
}

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  if (e.data.type === 'process') {
    try {
      const { payload } = e.data
      
      if (payload.type === 'file') {
        await processFile(payload.source as File, payload.partitions)
      } else {
        await processUrl(payload.source as string, payload.partitions)
      }
      
      self.postMessage({ type: 'success' } as WorkerResponse)
    } catch (error) {
      self.postMessage({
        type: 'error',
        error: error instanceof Error ? error.message : String(error)
      } as WorkerResponse)
    }
  }
}

async function processFile(file: File, partitions: string[]) {
  const arrayBuffer = await file.arrayBuffer()
  await processPayloadBuffer(arrayBuffer, partitions)
}

async function processUrl(url: string, partitions: string[]) {
  const response = await fetch(url)
  const arrayBuffer = await response.arrayBuffer()
  await processPayloadBuffer(arrayBuffer, partitions)
}

async function processPayloadBuffer(buffer: ArrayBuffer, partitions: string[]) {
  const parser = new PayloadParser(buffer)
  const { manifest } = await parser.parse()

  for (const partitionName of partitions) {
    try {
      const blob = await parser.extractPartition(partitionName, manifest)
      const url = URL.createObjectURL(blob)
      
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