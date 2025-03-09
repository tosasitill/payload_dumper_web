export interface PayloadInfo {
  type: 'file' | 'url';
  source: string | File;
  partitions: string[];
}

interface WorkerResponse {
  type: 'success' | 'error' | 'progress';
  error?: string;
  progress?: {
    partition: string;
    url: string;
  };
}

type WorkerModule = {
  default: new () => Worker;
};

export class PayloadHandler {
  private static instance: PayloadHandler;
  private worker: Worker | null = null;
  public onProgress?: (partition: string, url: string) => void;

  private constructor() {
    if (typeof window !== 'undefined') {
      this.initializeWorker();
    }
  }

  public static getInstance(): PayloadHandler {
    if (!PayloadHandler.instance) {
      PayloadHandler.instance = new PayloadHandler();
    }
    return PayloadHandler.instance;
  }

  private async initializeWorker() {
    if (typeof window !== 'undefined') {
      try {
        const WorkerModule = await import('../workers/payload.worker') as WorkerModule;
        console.log('Worker module loaded');
        this.worker = new WorkerModule.default();
        console.log('Worker initialized');

        if (this.worker) {
          // 添加错误处理
          this.worker.onerror = (error) => {
            console.error('Worker error:', error);
          };
        }
      } catch (error) {
        console.error('Failed to initialize worker:', error);
      }
    }
  }

  public async processPayload(info: PayloadInfo): Promise<void> {
    console.log('Processing payload:', info);
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        console.log('Worker not initialized, initializing...');
        this.initializeWorker().catch(error => {
          console.error('Failed to initialize worker:', error);
          reject(error);
        });
      }

      // 等待 Worker 初始化完成
      const waitForWorker = () => {
        if (this.worker) {
          console.log('Worker ready, sending message');
          const handleMessage = (e: MessageEvent<WorkerResponse>) => {
            console.log('Received worker message:', e.data);
            if (e.data.type === 'success') {
              resolve();
              this.worker?.removeEventListener('message', handleMessage);
            } else if (e.data.type === 'error') {
              reject(new Error(e.data.error));
              this.worker?.removeEventListener('message', handleMessage);
            } else if (e.data.type === 'progress' && e.data.progress) {
              this.onProgress?.(e.data.progress.partition, e.data.progress.url);
            }
          };

          this.worker.addEventListener('message', handleMessage);
          this.worker.postMessage({
            type: 'process',
            payload: info
          });
        } else {
          console.log('Worker not ready, waiting...');
          setTimeout(waitForWorker, 100);
        }
      };

      waitForWorker();
    });
  }

  private async processFile(file: File, partitions: string[]): Promise<void> {
    // 这里将来需要实现文件处理逻辑
    console.log('Processing file:', file.name);
    console.log('Selected partitions:', partitions);
  }

  private async processUrl(url: string, partitions: string[]): Promise<void> {
    // 这里将来需要实现URL处理逻辑
    console.log('Processing URL:', url);
    console.log('Selected partitions:', partitions);
  }
} 