import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PythBenchmarkRequestError,
  clearPythBenchmarkBarsCacheForTests,
  createPythBenchmarkBarsClient,
  type PythBenchmarkFetch,
  type PythBenchmarkFetchResponse,
} from './pyth-benchmarks.js';

function response(input: {
  ok: boolean;
  status: number;
  statusText?: string;
  retryAfter?: string;
  body?: unknown;
}): PythBenchmarkFetchResponse {
  return {
    ok: input.ok,
    status: input.status,
    statusText: input.statusText ?? '',
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'retry-after' ? (input.retryAfter ?? null) : null,
    },
    json: async () => input.body ?? {},
  };
}

const okBars = {
  s: 'ok',
  t: [100, 400],
  o: [10, 11],
  h: [12, 13],
  l: [9, 10],
  c: [11, 12],
};

test('PythBenchmarkBarsClient fetches recent bars by AssetId on a closed intraday window', async () => {
  clearPythBenchmarkBarsCacheForTests();
  let requestedUrl = '';
  const fetchImpl: PythBenchmarkFetch = async (url) => {
    requestedUrl = url;
    return response({ ok: true, status: 200, body: okBars });
  };

  const client = createPythBenchmarkBarsClient({
    baseUrl: 'https://benchmarks.pyth.network/',
    fetchImpl,
    nowMs: () => 1_000_000_000,
  });

  const bars = await client.getRecentBars({
    assetId: 'NVDAx',
    resolution: '5',
    hoursBack: 1,
  });

  assert.equal(
    requestedUrl,
    'https://benchmarks.pyth.network/v1/shims/tradingview/history?symbol=Crypto.NVDAX%2FUSD&resolution=5&from=996300&to=999900',
  );
  assert.equal(bars.length, 2);
});

test('PythBenchmarkBarsClient retries a transient 429 and returns bars', async () => {
  clearPythBenchmarkBarsCacheForTests();
  const calls: string[] = [];
  const fetchImpl: PythBenchmarkFetch = async (url) => {
    calls.push(url);
    if (calls.length === 1) {
      return response({ ok: false, status: 429, statusText: 'Too Many Requests', retryAfter: '1' });
    }
    return response({ ok: true, status: 200, body: okBars });
  };

  const sleeps: number[] = [];
  const client = createPythBenchmarkBarsClient({
    baseUrl: 'https://benchmarks.pyth.network/',
    fetchImpl,
    sleepMs: async (ms) => {
      sleeps.push(ms);
    },
  });
  const bars = await client.getBarsRange({
    assetId: 'NVDAx',
    resolution: '5',
    fromUnix: 0,
    toUnix: 600,
  });

  assert.equal(calls.length, 2);
  assert.equal(sleeps[0], 1_000);
  assert.deepEqual(bars, [
    { time: 100, open: 10, high: 12, low: 9, close: 11 },
    { time: 400, open: 11, high: 13, low: 10, close: 12 },
  ]);
});

test('PythBenchmarkBarsClient reuses stale cached bars when a later call is rate-limited', async () => {
  clearPythBenchmarkBarsCacheForTests();
  let now = 1_000;
  let callCount = 0;
  const fetchImpl: PythBenchmarkFetch = async () => {
    callCount += 1;
    if (callCount === 1) return response({ ok: true, status: 200, body: okBars });
    return response({ ok: false, status: 429, statusText: 'Too Many Requests' });
  };

  const client = createPythBenchmarkBarsClient({
    baseUrl: 'https://benchmarks.pyth.network',
    fetchImpl,
    cacheTtlMs: 10,
    staleTtlMs: 10_000,
    maxAttempts: 1,
    nowMs: () => now,
  });
  const request = {
    assetId: 'TRX',
    resolution: '5' as const,
    fromUnix: 0,
    toUnix: 600,
  };

  const freshBars = await client.getBarsRange(request);
  now += 20;
  const staleBars = await client.getBarsRange(request);

  assert.equal(callCount, 2);
  assert.deepEqual(staleBars, freshBars);
});

test('PythBenchmarkBarsClient throws a typed error when 429 persists without cache', async () => {
  clearPythBenchmarkBarsCacheForTests();
  const fetchImpl: PythBenchmarkFetch = async () =>
    response({ ok: false, status: 429, statusText: 'Too Many Requests' });
  const client = createPythBenchmarkBarsClient({
    baseUrl: 'https://benchmarks.pyth.network',
    fetchImpl,
    maxAttempts: 1,
  });

  await assert.rejects(
    client.getBarsRange({
      assetId: 'HYPE',
      resolution: '5',
      fromUnix: 0,
      toUnix: 600,
    }),
    (err) =>
      err instanceof PythBenchmarkRequestError &&
      err.rateLimited &&
      err.message === 'Pyth benchmarks HYPE/5 failed: 429 Too Many Requests',
  );
});

test('PythBenchmarkBarsClient stops provider calls during a rate-limit cooldown', async () => {
  clearPythBenchmarkBarsCacheForTests();
  let now = 1_000;
  let callCount = 0;
  const fetchImpl: PythBenchmarkFetch = async () => {
    callCount += 1;
    return response({ ok: false, status: 429, statusText: 'Too Many Requests' });
  };
  const client = createPythBenchmarkBarsClient({
    baseUrl: 'https://benchmarks.pyth.network',
    fetchImpl,
    maxAttempts: 1,
    nowMs: () => now,
  });

  await assert.rejects(
    client.getBarsRange({
      assetId: 'NVDAx',
      resolution: '5',
      fromUnix: 0,
      toUnix: 600,
    }),
    PythBenchmarkRequestError,
  );

  await assert.rejects(
    client.getBarsRange({
      assetId: 'AAPLx',
      resolution: '5',
      fromUnix: 0,
      toUnix: 600,
    }),
    PythBenchmarkRequestError,
  );

  now += 31_000;
  await assert.rejects(
    client.getBarsRange({
      assetId: 'TSLAx',
      resolution: '5',
      fromUnix: 0,
      toUnix: 600,
    }),
    PythBenchmarkRequestError,
  );

  assert.equal(callCount, 2);
});
