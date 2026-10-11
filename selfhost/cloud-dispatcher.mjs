import {Worker} from 'node:worker_threads';

const unavailable = (status = 503) => new Response(JSON.stringify({error: status === 429 ? '请求队列已满，请稍后重试。' : '运行服务正在恢复，请重试并确认上次操作的结果。'}), {status, headers: {'content-type': 'application/json; charset=utf-8', 'retry-after': '2'}});

export async function createCloudDispatcher(filename, {maxQueue = 32, timeoutMs = 30000} = {}) {
  let worker, stopped = false, active = null, sequence = 0, ready = false, restartTimer;
  const queue = [];
  const terminations = new Set(), terminating = new WeakMap();
  function terminate(target) {
    if (!target) return Promise.resolve();
    if (terminating.has(target)) return terminating.get(target);
    const done = target.terminate().catch(() => {});
    terminating.set(target, done); terminations.add(done);
    void done.then(() => terminations.delete(done));
    return done;
  }
  function cancelAll() {
    if (active) { clearTimeout(active.timer); active.resolve(unavailable()); active = null; }
    for (const item of queue.splice(0)) item.resolve(unavailable());
  }
  function pump() {
    if (stopped || !ready || active || !queue.length) return;
    active = queue.shift();
    active.timer = setTimeout(() => failed(worker), timeoutMs);
    worker.postMessage({id: active.id, request: active.request});
  }
  function failed(failedWorker) {
    if (worker !== failedWorker || stopped) return;
    ready = false; worker = null; cancelAll();
    void terminate(failedWorker).then(() => {
      if (!stopped && !worker) restartTimer = setTimeout(() => { if (!stopped) void start().catch(() => {}); }, 1000);
    });
  }
  function start() {
    return new Promise((resolve, reject) => {
      const next = new Worker(new URL('./cloud-worker.mjs', import.meta.url), {workerData: {filename}, resourceLimits: {maxOldGenerationSizeMb: 256}});
      worker = next;
      const startup = setTimeout(() => { reject(new Error('Simulation service startup timed out.')); failed(next); }, 15000);
      next.on('message', message => {
        if (worker !== next || stopped) return;
        if (message.ready) { clearTimeout(startup); ready = true; resolve(); pump(); return; }
        if (active && message.id === active.id) {
          clearTimeout(active.timer);
          active.resolve(new Response(message.response.body, {status: message.response.status, headers: message.response.headers}));
          active = null; pump();
        }
      });
      next.on('error', error => { clearTimeout(startup); reject(error); failed(next); });
      next.on('exit', () => { clearTimeout(startup); reject(new Error('Simulation service exited.')); failed(next); });
    });
  }
  try { await start(); } catch (error) { stopped = true; clearTimeout(restartTimer); await terminate(worker); await Promise.all([...terminations]); throw error; }
  return {
    get ready() { return ready && !stopped; },
    async handle(request) {
      if (stopped || !ready) return unavailable();
      if (queue.length + (active ? 1 : 0) >= maxQueue) return unavailable(429);
      const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text();
      if (stopped || !ready) return unavailable();
      if (queue.length + (active ? 1 : 0) >= maxQueue) return unavailable(429);
      return new Promise(resolve => { queue.push({id: ++sequence, resolve, request: {url: request.url, method: request.method, headers: [...request.headers], body}}); pump(); });
    },
    async close() { stopped = true; ready = false; clearTimeout(restartTimer); cancelAll(); await terminate(worker); await Promise.all([...terminations]); },
  };
}
