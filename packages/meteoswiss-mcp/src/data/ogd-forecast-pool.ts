/**
 * Small worker-thread pool that builds forecast indexes off the event loop.
 *
 * A cold forecast request parses ~190 MB of CSV. Even at several hundred MB/s that is more than half
 * a second of single-threaded work, during which every other session's request would stall, so the
 * large files are handed to worker threads and the results (flat typed arrays) are transferred back.
 *
 * Everything here is an optimisation, never a dependency: small inputs, a disabled pool
 * (`OGD_PARSE_WORKERS=0`) and any worker failure all fall back to building on the calling thread.
 * Workers are created lazily, capped, and terminated after a period of idleness so they hold no
 * memory between forecast runs.
 */

import { Worker } from 'node:worker_threads';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildForecastIndex, type ForecastIndex } from './ogd-forecast-index.js';
import { fromWire, type WorkerRequest, type WorkerResponse } from './ogd-forecast-worker.js';
import type { MemoBuild } from './ogd-parse-memo.js';
import { debugData } from '../support/logging.js';

/** Inputs smaller than this are built in-thread: messaging costs more than the parse. */
const MIN_OFFLOAD_BYTES = 4 * 1024 * 1024;
const IDLE_TERMINATE_MS = 30_000;

function envInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return process.env[name] !== undefined && Number.isInteger(parsed) && parsed >= 0
    ? parsed
    : fallback;
}

/** Upper bound on worker threads (`OGD_PARSE_WORKERS`; `0` disables the pool). */
const MAX_WORKERS = envInt(
  'OGD_PARSE_WORKERS',
  Math.min(2, Math.max(0, os.availableParallelism() - 1))
);

type Pending = {
  request: WorkerRequest;
  resolve: (result: MemoBuild<ForecastIndex>) => void;
  reject: (error: Error) => void;
};
type Slot = { worker: Worker; job: Pending | null; idleTimer: NodeJS.Timeout | null };

const slots: Slot[] = [];
const queue: Pending[] = [];
let nextId = 1;
let warnedFallback = false;

/** Extension of this module (`.ts` under tsx, `.js` once built), so the worker file matches it. */
const MODULE_EXT = path.extname(fileURLToPath(import.meta.url));

function spawn(): Slot {
  const workerUrl = new URL(`./ogd-forecast-worker${MODULE_EXT}`, import.meta.url);
  // From source (dev, bench) the worker needs tsx's `.js` -> `.ts` resolution, which a bare
  // `new Worker(file.ts)` does not get; the built output is plain JavaScript and does not.
  const worker =
    MODULE_EXT === '.ts'
      ? new Worker(
          `import('tsx/esm/api').then(({ register }) => { register(); return import(${JSON.stringify(workerUrl.href)}); })`,
          { eval: true }
        )
      : new Worker(workerUrl);
  worker.unref();
  const slot: Slot = { worker, job: null, idleTimer: null };
  worker.on('message', (response: WorkerResponse) => {
    const job = slot.job;
    if (job === null || response.id !== job.request.id) return;
    slot.job = null;
    if (response.ok) {
      const wire = response.wire;
      job.resolve({ value: fromWire(wire), bytes: wire.bytes });
    } else {
      job.reject(new Error(response.message));
    }
    pump(slot);
  });
  const fail = (error: Error): void => {
    const job = slot.job;
    slot.job = null;
    const at = slots.indexOf(slot);
    if (at >= 0) slots.splice(at, 1);
    if (slot.idleTimer) clearTimeout(slot.idleTimer);
    job?.reject(error);
    if (at >= 0) refill(error);
  };
  worker.on('error', fail);
  worker.on('exit', (code) => fail(new Error(`forecast parse worker exited (${code})`)));
  return slot;
}

/**
 * After a worker is lost, keep queued jobs moving: start replacement workers while work is waiting.
 * If a replacement cannot be started, reject the queue so those callers take their in-thread
 * fallback instead of waiting on a promise nothing will ever settle.
 */
function refill(cause: Error): void {
  while (queue.length > 0 && slots.length < MAX_WORKERS) {
    const job = queue.shift()!;
    try {
      const slot = spawn();
      slots.push(slot);
      dispatch(slot, job);
    } catch (error) {
      const failure = error instanceof Error ? error : cause;
      job.reject(failure);
      for (const waiting of queue.splice(0)) waiting.reject(failure);
      return;
    }
  }
}

/** Terminate every live worker. Test hook: simulates workers dying mid-job. */
export function terminateWorkersForTest(): void {
  for (const slot of [...slots]) void slot.worker.terminate();
}

function dispatch(slot: Slot, job: Pending): void {
  if (slot.idleTimer) clearTimeout(slot.idleTimer);
  slot.idleTimer = null;
  slot.job = job;
  slot.worker.postMessage(job.request, [job.request.bytes.buffer as ArrayBuffer]);
}

function pump(slot: Slot): void {
  const next = queue.shift();
  if (next) {
    dispatch(slot, next);
    return;
  }
  slot.idleTimer = setTimeout(() => {
    const at = slots.indexOf(slot);
    if (at >= 0) slots.splice(at, 1);
    void slot.worker.terminate();
  }, IDLE_TERMINATE_MS);
  slot.idleTimer.unref();
}

function submit(request: WorkerRequest): Promise<MemoBuild<ForecastIndex>> {
  return new Promise((resolve, reject) => {
    const job: Pending = { request, resolve, reject };
    const idle = slots.find((s) => s.job === null);
    if (idle) {
      dispatch(idle, job);
    } else if (slots.length < MAX_WORKERS) {
      const slot = spawn();
      slots.push(slot);
      dispatch(slot, job);
    } else {
      queue.push(job);
    }
  });
}

/**
 * Build a forecast index, on a worker thread when the input is large enough to be worth it.
 *
 * @param csv - Raw forecast CSV bytes
 * @param param - Value column name, e.g. `tre200h0`
 * @returns The index and its approximate retained size in bytes
 */
export async function buildForecastIndexOffThread(
  csv: Buffer,
  param: string,
  reload: () => Promise<Buffer>
): Promise<MemoBuild<ForecastIndex>> {
  if (MAX_WORKERS === 0 || csv.length < MIN_OFFLOAD_BYTES) return buildForecastIndex(csv, param);
  try {
    // The bytes are transferred (zero-copy), so the caller's buffer is gone after this; `reload`
    // supplies them again if the worker fails.
    const owned =
      csv.byteOffset === 0 && csv.byteLength === csv.buffer.byteLength ? csv : Buffer.from(csv);
    const bytes = new Uint8Array(owned.buffer, owned.byteOffset, owned.byteLength);
    return await submit({ id: nextId++, bytes, param });
  } catch (error) {
    if (!warnedFallback) {
      warnedFallback = true;
      console.error(
        '[ogd-store] Parse worker failed, building on the main thread:',
        error instanceof Error ? error.message : String(error)
      );
    }
    debugData('[ogd-pool] worker failure for %s: %O', param, error);
    return buildForecastIndex(await reload(), param);
  }
}
