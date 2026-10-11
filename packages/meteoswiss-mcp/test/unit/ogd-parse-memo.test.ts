import { describe, expect, it, beforeAll, beforeEach } from 'vitest';

type Memo = typeof import('../../src/data/ogd-parse-memo.js');
let memo: Memo;

/** Builder that counts calls and reports a fixed size. */
function counting(bytes: number): {
  build: () => Promise<{ value: string; bytes: number }>;
  calls: () => number;
} {
  let n = 0;
  return {
    build: async () => {
      n++;
      await new Promise((r) => setTimeout(r, 5));
      return { value: `v${n}`, bytes };
    },
    calls: () => n,
  };
}

beforeAll(async () => {
  // The bound is read at module load.
  process.env.OGD_PARSE_CACHE_MAX_BYTES = '1000';
  memo = await import('../../src/data/ogd-parse-memo.js');
});

beforeEach(() => memo.clearMemo());

describe('parse memo', () => {
  it('builds once per key and version', async () => {
    const b = counting(100);
    expect(await memo.memoize('k', 'v1', b.build)).toBe('v1');
    expect(await memo.memoize('k', 'v1', b.build)).toBe('v1');
    expect(b.calls()).toBe(1);
  });

  it('shares one build between concurrent callers (single-flight)', async () => {
    const b = counting(100);
    const results = await Promise.all(
      Array.from({ length: 8 }, () => memo.memoize('k', 'v1', b.build))
    );
    expect(b.calls()).toBe(1);
    expect(new Set(results)).toEqual(new Set(['v1']));
  });

  it('rebuilds on a new version and releases the old form', async () => {
    const b = counting(400);
    await memo.memoize('k', 'v1', b.build);
    expect(await memo.memoize('k', 'v2', b.build)).toBe('v2');
    expect(b.calls()).toBe(2);
    expect(memo.memoStats()).toEqual({ entries: 1, bytes: 400 });
  });

  it('evicts least-recently-used entries past the byte bound', async () => {
    const b = counting(400);
    await memo.memoize('a', 'v', b.build);
    await memo.memoize('b', 'v', b.build);
    await memo.memoize('a', 'v', b.build); // touch a → b is now oldest
    await memo.memoize('c', 'v', b.build); // 1200 > 1000 → evict b
    expect(memo.memoStats()).toEqual({ entries: 2, bytes: 800 });
    const before = b.calls();
    await memo.memoize('a', 'v', b.build);
    expect(b.calls()).toBe(before); // a retained
    await memo.memoize('b', 'v', b.build);
    expect(b.calls()).toBe(before + 1); // b was evicted
  });

  it('serves but does not retain an entry larger than the whole bound', async () => {
    const b = counting(5000);
    expect(await memo.memoize('big', 'v', b.build)).toBe('v1');
    expect(memo.memoStats()).toEqual({ entries: 0, bytes: 0 });
    await memo.memoize('big', 'v', b.build);
    expect(b.calls()).toBe(2);
  });

  it('never caches a rejection', async () => {
    let n = 0;
    const flaky = async (): Promise<{ value: string; bytes: number }> => {
      n++;
      if (n === 1) throw new Error('boom');
      return { value: 'ok', bytes: 10 };
    };
    await expect(memo.memoize('k', 'v', flaky)).rejects.toThrow('boom');
    expect(await memo.memoize('k', 'v', flaky)).toBe('ok');
    expect(n).toBe(2);
  });
});
