/**
 * Worker-driven frame clock (SPEC §10.2). Workers are throttled less than main-thread timers when the
 * tab is not focused, but foreground operation remains the qualified baseline.
 */
const WORKER_SOURCE = `
let id = null;
onmessage = (e) => {
  if (e.data.cmd === 'start') { clearInterval(id); id = setInterval(() => postMessage(0), e.data.ms); }
  if (e.data.cmd === 'stop') { clearInterval(id); id = null; }
};
`;

export class FrameClock {
  private worker: Worker;
  private url: string;
  constructor(fps: number, onTick: () => void) {
    this.url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
    this.worker = new Worker(this.url);
    this.worker.onmessage = () => onTick();
    this.worker.postMessage({ cmd: 'start', ms: 1000 / fps });
  }
  dispose(): void {
    this.worker.postMessage({ cmd: 'stop' });
    this.worker.terminate();
    URL.revokeObjectURL(this.url);
  }
}
