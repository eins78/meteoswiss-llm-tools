import { describe, expect, it, beforeAll } from 'vitest';

/**
 * A lost worker must not strand the jobs queued behind it. With a single worker and several large
 * files queued, killing that worker used to leave every queued promise pending forever (and, as they
 * are the memo's single-flight promises, hang every later request for those files).
 */

type Pool = typeof import('../../src/data/ogd-forecast-pool.js');
let pool: Pool;

function bigCsv(): Buffer {
  const rows = ['point_id;point_type_id;Date;x'];
  for (let t = 0; t < 120; t++) {
    for (let p = 1; p <= 2400; p++) {
      rows.push(
        `${p};1;2026010${1 + (t % 9)}${String(t % 24).padStart(2, '0')}00;${p % 50}.${t % 10}`
      );
    }
  }
  return Buffer.from(`${rows.join('\n')}\n`);
}

beforeAll(async () => {
  process.env.OGD_PARSE_WORKERS = '1'; // read at module load
  pool = await import('../../src/data/ogd-forecast-pool.js');
});

describe('forecast worker pool — lost workers', () => {
  it('settles every queued job when the only worker is terminated', async () => {
    const csv = bigCsv();
    expect(csv.length).toBeGreaterThan(4 * 1024 * 1024);

    const jobs = Array.from({ length: 4 }, () =>
      pool.buildForecastIndexOffThread(Buffer.from(csv), 'x', async () => Buffer.from(csv))
    );
    // Let the first job reach the worker, then kill it while the rest are queued.
    await new Promise((resolve) => setTimeout(resolve, 100));
    pool.terminateWorkersForTest();

    const results = await Promise.race([
      Promise.all(jobs),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('queued jobs never settled')), 40_000)
      ),
    ]);
    expect(results).toHaveLength(4);
    for (const result of results) expect(result.value.points.size).toBe(2400);
  }, 60_000);
});
