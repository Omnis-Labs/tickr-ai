import { requireAsset } from './assets.js';
import type { Bar } from './types.js';

export type PythBenchmarkResolution = '1' | '5' | '15' | '60' | 'D';
export type PythBenchmarkIntradayResolution = Exclude<PythBenchmarkResolution, 'D'>;
export type PythBenchmarkCacheMode =
  | 'default'
  | 'force-cache'
  | 'no-cache'
  | 'no-store'
  | 'only-if-cached'
  | 'reload';

interface TvResponse {
  s: 'ok' | 'no_data' | 'error';
  t?: number[];
  o?: number[];
  h?: number[];
  l?: number[];
  c?: number[];
  errmsg?: string;
}

export interface PythBenchmarkFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: {
    get(name: string): string | null;
  };
  json(): Promise<unknown>;
}

export type PythBenchmarkFetch = (
  url: string,
  init?: {
    headers?: Record<string, string>;
    cache?: PythBenchmarkCacheMode;
  },
) => Promise<PythBenchmarkFetchResponse>;

export class PythBenchmarkRequestError extends Error {
  readonly assetId: string;
  readonly resolution: PythBenchmarkResolution;
  readonly status?: number;

  constructor(input: {
    assetId: string;
    resolution: PythBenchmarkResolution;
    message: string;
    status?: number;
  }) {
    super(input.message);
    this.name = 'PythBenchmarkRequestError';
    this.assetId = input.assetId;
    this.resolution = input.resolution;
    this.status = input.status;
  }

  get rateLimited(): boolean {
    return this.status === 429;
  }
}

interface FetchPythBenchmarkBarsInput {
  baseUrl: string;
  assetId: string;
  symbol: string;
  resolution: PythBenchmarkResolution;
  fromUnix: number;
  toUnix: number;
  fetchImpl: PythBenchmarkFetch;
  cacheMode?: PythBenchmarkCacheMode;
  cacheTtlMs?: number;
  staleTtlMs?: number;
  maxAttempts?: number;
  requestSpacingMs?: number;
  sleepMs?: (ms: number) => Promise<void>;
  nowMs?: () => number;
}

export interface PythBenchmarkBarsRequestOptions {
  cacheMode?: PythBenchmarkCacheMode;
  cacheTtlMs?: number;
  staleTtlMs?: number;
  maxAttempts?: number;
}

export interface PythBenchmarkBarsClient {
  getBarsRange(
    input: {
      assetId: string;
      resolution: PythBenchmarkResolution;
      fromUnix: number;
      toUnix: number;
    } & PythBenchmarkBarsRequestOptions,
  ): Promise<Bar[]>;
  getRecentBars(
    input: {
      assetId: string;
      resolution: PythBenchmarkIntradayResolution;
      hoursBack?: number;
    } & PythBenchmarkBarsRequestOptions,
  ): Promise<Bar[]>;
  getDailyBars(
    input: {
      assetId: string;
      days?: number;
    } & PythBenchmarkBarsRequestOptions,
  ): Promise<Bar[]>;
}

export interface CreatePythBenchmarkBarsClientInput {
  baseUrl: string;
  fetchImpl: PythBenchmarkFetch;
  cacheMode?: PythBenchmarkCacheMode;
  cacheTtlMs?: number;
  staleTtlMs?: number;
  maxAttempts?: number;
  requestSpacingMs?: number;
  sleepMs?: (ms: number) => Promise<void>;
  nowMs?: () => number;
}

interface CacheEntry {
  bars: Bar[];
  expiresAtMs: number;
  staleUntilMs: number;
}

const DEFAULT_CACHE_TTL_MS = 60_000;
const DEFAULT_STALE_TTL_MS = 15 * 60_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 500;
const RATE_LIMIT_COOLDOWN_MS = 30_000;
const MAX_RETRY_AFTER_MS = 2_500;

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<Bar[]>>();
let nextRequestAtMs = 0;
let rateLimitedUntilMs = 0;

function pythSymbol(assetId: string): string {
  const asset = requireAsset(assetId);
  if (!asset.pythSymbol) {
    throw new Error(`[benchmarks] ${assetId} has no configured Pyth symbol`);
  }
  return asset.pythSymbol;
}

function cacheKey(input: FetchPythBenchmarkBarsInput): string {
  return [
    input.baseUrl.replace(/\/+$/, ''),
    input.symbol,
    input.resolution,
    input.fromUnix,
    input.toUnix,
  ].join('|');
}

function buildUrl(input: FetchPythBenchmarkBarsInput): string {
  const baseUrl = input.baseUrl.replace(/\/+$/, '');
  return (
    `${baseUrl}/v1/shims/tradingview/history` +
    `?symbol=${encodeURIComponent(input.symbol)}` +
    `&resolution=${input.resolution}` +
    `&from=${input.fromUnix}&to=${input.toUnix}`
  );
}

function retryAfterMs(value: string | null, nowMs: () => number): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  }

  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) {
    return Math.min(Math.max(0, dateMs - nowMs()), MAX_RETRY_AFTER_MS);
  }
  return null;
}

function shouldRetry(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function rateLimitedError(input: FetchPythBenchmarkBarsInput): PythBenchmarkRequestError {
  return new PythBenchmarkRequestError({
    assetId: input.assetId,
    resolution: input.resolution,
    status: 429,
    message: `Pyth benchmarks ${input.assetId}/${input.resolution} skipped: rate limited`,
  });
}

async function waitForRequestTurn(input: FetchPythBenchmarkBarsInput): Promise<void> {
  const spacing = input.requestSpacingMs ?? 0;
  if (spacing <= 0) return;

  const now = (input.nowMs ?? Date.now)();
  const waitMs = Math.max(0, nextRequestAtMs - now);
  nextRequestAtMs = Math.max(now, nextRequestAtMs) + spacing;
  if (waitMs > 0) await (input.sleepMs ?? sleep)(waitMs);
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function parseBars(input: FetchPythBenchmarkBarsInput, json: TvResponse): Bar[] {
  if (json.s === 'no_data' || !json.t) return [];
  if (json.s !== 'ok' || !json.o || !json.h || !json.l || !json.c) {
    throw new PythBenchmarkRequestError({
      assetId: input.assetId,
      resolution: input.resolution,
      message: `Pyth benchmarks ${input.assetId}/${input.resolution}: ${json.errmsg ?? json.s}`,
    });
  }
  return json.t.map((time, index) => ({
    time,
    open: json.o![index] ?? 0,
    high: json.h![index] ?? 0,
    low: json.l![index] ?? 0,
    close: json.c![index] ?? 0,
  }));
}

async function fetchBars(input: FetchPythBenchmarkBarsInput): Promise<Bar[]> {
  const maxAttempts = Math.max(1, input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const nowMs = input.nowMs ?? Date.now;
  const sleepFn = input.sleepMs ?? sleep;
  const url = buildUrl(input);
  let lastError: PythBenchmarkRequestError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await waitForRequestTurn(input);
    const res = await input.fetchImpl(url, {
      headers: { accept: 'application/json' },
      ...(input.cacheMode ? { cache: input.cacheMode } : {}),
    });

    if (res.ok) {
      const json = (await res.json()) as TvResponse;
      return parseBars(input, json);
    }

    lastError = new PythBenchmarkRequestError({
      assetId: input.assetId,
      resolution: input.resolution,
      status: res.status,
      message: `Pyth benchmarks ${input.assetId}/${input.resolution} failed: ${res.status} ${res.statusText}`,
    });

    if (attempt === maxAttempts || !shouldRetry(res.status)) break;
    const delayMs =
      retryAfterMs(res.headers.get('retry-after'), nowMs) ??
      Math.min(DEFAULT_RETRY_DELAY_MS * 2 ** (attempt - 1), MAX_RETRY_AFTER_MS);
    if (delayMs > 0) await sleepFn(delayMs);
  }

  throw lastError;
}

async function fetchPythBenchmarkBars(input: FetchPythBenchmarkBarsInput): Promise<Bar[]> {
  if (input.toUnix <= input.fromUnix) return [];

  const key = cacheKey(input);
  const now = (input.nowMs ?? Date.now)();
  const cached = cache.get(key);
  if (cached && cached.expiresAtMs > now) return cached.bars;

  if (rateLimitedUntilMs > now) {
    if (cached && cached.staleUntilMs > now) return cached.bars;
    throw rateLimitedError(input);
  }

  const existing = inFlight.get(key);
  if (existing) return existing;

  const request = fetchBars(input)
    .then((bars) => {
      const finishedAt = (input.nowMs ?? Date.now)();
      cache.set(key, {
        bars,
        expiresAtMs: finishedAt + (input.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS),
        staleUntilMs: finishedAt + (input.staleTtlMs ?? DEFAULT_STALE_TTL_MS),
      });
      return bars;
    })
    .catch((err: unknown) => {
      const fallback = cache.get(key);
      const failedAt = (input.nowMs ?? Date.now)();
      if (err instanceof PythBenchmarkRequestError && err.rateLimited) {
        rateLimitedUntilMs = Math.max(rateLimitedUntilMs, failedAt + RATE_LIMIT_COOLDOWN_MS);
      }
      if (
        fallback &&
        fallback.staleUntilMs > failedAt &&
        err instanceof PythBenchmarkRequestError &&
        err.rateLimited
      ) {
        return fallback.bars;
      }
      throw err;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, request);
  return request;
}

export function createPythBenchmarkBarsClient(
  input: CreatePythBenchmarkBarsClientInput,
): PythBenchmarkBarsClient {
  const nowMs = input.nowMs ?? Date.now;

  function fetchAssetBars(
    request: {
      assetId: string;
      resolution: PythBenchmarkResolution;
      fromUnix: number;
      toUnix: number;
    } & PythBenchmarkBarsRequestOptions,
  ): Promise<Bar[]> {
    return fetchPythBenchmarkBars({
      baseUrl: input.baseUrl,
      assetId: request.assetId,
      symbol: pythSymbol(request.assetId),
      resolution: request.resolution,
      fromUnix: request.fromUnix,
      toUnix: request.toUnix,
      fetchImpl: input.fetchImpl,
      cacheMode: request.cacheMode ?? input.cacheMode,
      cacheTtlMs: request.cacheTtlMs ?? input.cacheTtlMs,
      staleTtlMs: request.staleTtlMs ?? input.staleTtlMs,
      maxAttempts: request.maxAttempts ?? input.maxAttempts,
      requestSpacingMs: input.requestSpacingMs,
      sleepMs: input.sleepMs,
      nowMs,
    });
  }

  return {
    getBarsRange: fetchAssetBars,
    getRecentBars: (request) => {
      const resolutionSeconds = Number(request.resolution) * 60;
      const nowUnix = Math.floor(nowMs() / 1000);
      const toUnix = Math.floor(nowUnix / resolutionSeconds) * resolutionSeconds;
      const fromUnix = toUnix - (request.hoursBack ?? 24) * 3600;
      return fetchAssetBars({
        ...request,
        fromUnix,
        toUnix,
      });
    },
    getDailyBars: (request) => {
      const nowUnix = Math.floor(nowMs() / 1000);
      const toUnix = Math.floor(nowUnix / 3600) * 3600;
      const fromUnix = toUnix - (request.days ?? 365) * 86_400;
      return fetchAssetBars({
        ...request,
        resolution: 'D',
        fromUnix,
        toUnix,
      });
    },
  };
}

export function clearPythBenchmarkBarsCacheForTests(): void {
  cache.clear();
  inFlight.clear();
  nextRequestAtMs = 0;
  rateLimitedUntilMs = 0;
}
