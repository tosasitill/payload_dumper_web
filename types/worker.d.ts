declare module '*.worker' {
  class WebpackWorker extends Worker {
    constructor();
  }

  export default WebpackWorker;
}

declare module '*.worker.ts' {
  class WebpackWorker extends Worker {
    constructor();
  }

  export default WebpackWorker;
}

declare module '*?worker' {
  const WorkerConstructor: {
    new (): Worker;
  };
  export default WorkerConstructor;
} 