/**
 * Worker-thread entry: builds a forecast index off the main thread.
 *
 * Receives `{ id, bytes, param }`, replies `{ id, ok: true, wire }` with the index flattened into
 * transferable typed arrays, or `{ id, ok: false, message }` if the build threw.
 */

import { parentPort } from 'node:worker_threads';
import { buildForecastIndex, type ForecastIndex } from './ogd-forecast-index.js';

/** An index in a form that moves between threads without copying its big arrays. */
export type IndexWire = {
  timestampTable: string[];
  timestamps: Uint32Array;
  values: Float64Array;
  keys: string[];
  offsets: Uint32Array;
  lengths: Uint32Array;
  bytes: number;
};

export type WorkerRequest = { id: number; bytes: Uint8Array; param: string };
export type WorkerResponse =
  | { id: number; ok: true; wire: IndexWire }
  | { id: number; ok: false; message: string };

/** Flatten an index for transfer. */
export function toWire(index: ForecastIndex, bytes: number): IndexWire {
  const keys = [...index.points.keys()];
  const offsets = new Uint32Array(keys.length);
  const lengths = new Uint32Array(keys.length);
  keys.forEach((key, i) => {
    const series = index.points.get(key)!;
    offsets[i] = series.offset;
    lengths[i] = series.length;
  });
  return {
    timestampTable: index.timestampTable,
    timestamps: index.timestamps,
    values: index.values,
    keys,
    offsets,
    lengths,
    bytes,
  };
}

/** Rebuild an index from its wire form. */
export function fromWire(wire: IndexWire): ForecastIndex {
  const points = new Map<string, { offset: number; length: number }>();
  wire.keys.forEach((key, i) =>
    points.set(key, { offset: wire.offsets[i]!, length: wire.lengths[i]! })
  );
  return {
    timestampTable: wire.timestampTable,
    timestamps: wire.timestamps,
    values: wire.values,
    points,
  };
}

if (parentPort !== null) {
  const port = parentPort;
  port.on('message', (request: WorkerRequest) => {
    try {
      const { value, bytes } = buildForecastIndex(request.bytes, request.param);
      const wire = toWire(value, bytes);
      const response: WorkerResponse = { id: request.id, ok: true, wire };
      port.postMessage(response, [
        wire.timestamps.buffer as ArrayBuffer,
        wire.values.buffer as ArrayBuffer,
        wire.offsets.buffer as ArrayBuffer,
        wire.lengths.buffer as ArrayBuffer,
      ]);
    } catch (error) {
      const response: WorkerResponse = {
        id: request.id,
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
      port.postMessage(response);
    }
  });
}
