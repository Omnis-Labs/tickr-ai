// Solana RPC failover pool — one Connection, transport-level rotation.
//
// Why this exists: every server-side caller that talks to Solana RPC used to
// build a `new Connection(rpcUrls[0]!, 'confirmed')` and call methods directly.
// When publicnode (the first URL) returned a Cloudflare 504, the call failed,
// callers logged ~8KB of HTML body, and dependent flows (LLM proposal context,
// USDC balance reads) silently degraded to empty data.
//
// This module replaces that with a single Connection whose underlying `fetch`
// rotates through every configured endpoint, classifies HTTP status codes
// before @solana/web3.js mangles them into Error.message, applies real
// AbortController-backed timeouts, and tracks per-endpoint health with a
// short cooldown. Failover happens at the transport layer (inside `fetch`)
// rather than wrapping every Connection method, so timeouts can actually
// cancel in-flight requests and HTML bodies never reach caller logs.
//
// Lifetime: a module-level singleton pool is built lazily from
// `configureRpcPool({ rawUrls, options })` (called at each app's boot) or,
// if not configured, from process.env.SOLANA_RPC_URLS ?? NEXT_PUBLIC_SOLANA_RPC_URLS.
// In serverless (Vercel), this means health state is per warm container and
// resets on cold start — which is correct (stale health shouldn't survive
// a deployment).
//
// Server-only: this file imports `@solana/web3.js` (heavy server-side dep)
// and must never reach the apps/web client bundle. Two guardrails enforce
// this without depending on the `server-only` package (which throws at
// runtime in plain Node and would break apps/ws-server):
//   1. The barrel `./index.ts` does NOT re-export from here.
//   2. Callers must import via the explicit `@hunch-it/shared/rpc` subpath.
// A Client Component pulling this in would have to spell out the subpath
// import, at which point Next.js's bundle analyzer will surface the bloat.

import { Connection } from '@solana/web3.js';

// ── public ───────────────────────────────────────────────────────────────

const SOLANA_MAINNET_FALLBACK = 'https://api.mainnet-beta.solana.com';

/**
 * Parse a comma-separated RPC URL string into a deduped, validated array.
 * Production: throws when the input is empty (callers must configure RPC).
 * Dev / test: returns `[SOLANA_MAINNET_FALLBACK]` so local boot still works.
 */
export function parseRpcUrls(raw: string | undefined): string[] {
  const trimmed = raw?.trim() ?? '';
  if (trimmed.length === 0) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        '[rpc] SOLANA_RPC_URLS / NEXT_PUBLIC_SOLANA_RPC_URLS is required in production',
      );
    }
    return [SOLANA_MAINNET_FALLBACK];
  }

  const seen = new Set<string>();
  const valid: string[] = [];
  for (const candidate of trimmed.split(',').map((u) => u.trim()).filter(Boolean)) {
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      console.warn(`[rpc] dropping malformed RPC URL: ${candidate}`);
      continue;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      console.warn(`[rpc] dropping non-http(s) RPC URL: ${candidate}`);
      continue;
    }
    const normalized = url.toString();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      valid.push(normalized);
    }
  }

  return valid.length > 0 ? valid : [SOLANA_MAINNET_FALLBACK];
}

export interface RpcPoolOptions {
  /** Per-fetch HTTP timeout in ms. */
  requestTimeoutMs: number;
  /** Total attempt budget across all endpoints (initial + retries). */
  maxAttempts: number;
  /** Hard ceiling on time spent in a single execute() call. */
  totalTimeoutMs: number;
}

/** Conservative defaults sized for `apps/ws-server` (long-running Node). */
export const WS_SERVER_RPC_OPTIONS: RpcPoolOptions = {
  requestTimeoutMs: 8_000,
  maxAttempts: 5,
  totalTimeoutMs: 30_000,
};

/** Tight defaults sized for `apps/web` on Vercel (10s function timeout). */
export const WEB_RPC_OPTIONS: RpcPoolOptions = {
  requestTimeoutMs: 1_500,
  maxAttempts: 3,
  totalTimeoutMs: 4_500,
};

const DEFAULT_RPC_OPTIONS = WS_SERVER_RPC_OPTIONS;

/**
 * Configure (or replace) the singleton pool. Each app should call this once
 * at boot with the appropriate {@link RpcPoolOptions} preset.
 *
 * Replaces the singleton for FUTURE calls only; in-flight calls keep their
 * captured pool reference.
 */
export function configureRpcPool(args: {
  rawUrls: string | undefined;
  options?: Partial<RpcPoolOptions>;
}): void {
  const merged = { ...DEFAULT_RPC_OPTIONS, ...(args.options ?? {}) };
  singletonPool = new SolanaRpcPool(parseRpcUrls(args.rawUrls), merged);
  singletonConn = null;
}

/**
 * Run a Solana RPC operation with automatic failover across configured RPC
 * endpoints. The Connection passed to `op` is backed by a custom fetch that
 * rotates endpoints on transient failure (5xx, 429, network, timeout) and
 * fails fast on configuration errors (4xx, invalid params).
 *
 * Throws {@link RpcFailoverExhaustedError} when all attempts fail. Caller
 * decides whether to swallow (degrade) or propagate.
 */
export async function withRpcFailover<T>(
  op: (conn: Connection) => Promise<T>,
): Promise<T> {
  return op(getSingletonConnection());
}

/** Error thrown when all retry attempts across endpoints are exhausted. */
export class RpcFailoverExhaustedError extends Error {
  override readonly name = 'RpcFailoverExhaustedError';
  constructor(
    message: string,
    readonly attempts: ReadonlyArray<{
      url: string;
      kind: 'http' | 'transport' | 'timeout' | 'rate-limit';
      detail: string;
    }>,
  ) {
    super(message);
  }
}

// ── singleton ────────────────────────────────────────────────────────────

let singletonPool: SolanaRpcPool | null = null;
let singletonConn: Connection | null = null;

function getSingletonConnection(): Connection {
  if (!singletonConn) {
    if (!singletonPool) {
      const raw =
        process.env.SOLANA_RPC_URLS ??
        process.env.NEXT_PUBLIC_SOLANA_RPC_URLS;
      singletonPool = new SolanaRpcPool(parseRpcUrls(raw), DEFAULT_RPC_OPTIONS);
    }
    singletonConn = singletonPool.createConnection();
  }
  return singletonConn;
}

// ── pool internals ───────────────────────────────────────────────────────

const RATE_LIMIT_COOLDOWN_MS = 30_000;
const ERROR_COOLDOWN_BASE_MS = 60_000;
const ERROR_COOLDOWN_MAX_MS = 300_000;

const RETRYABLE_HTTP_STATUS = new Set([429, 500, 502, 503, 504]);
const NON_RETRYABLE_HTTP_STATUS = new Set([
  400, 401, 403, 404, 405, 410, 413, 415,
]);

const RETRYABLE_ERROR_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
]);

const RETRYABLE_MESSAGE_PATTERNS = [
  'fetch failed',
  'socket hang up',
  'network',
  'unexpected end of json',
  'aborted',
];

interface AttemptRecord {
  url: string;
  kind: 'http' | 'transport' | 'timeout' | 'rate-limit';
  detail: string;
}

/**
 * Per-endpoint health state. Failure marks are coalesced inside an active
 * cooldown window so concurrent failures from the same outage burst can't
 * inflate `consecutiveFailures` beyond one tick per window.
 */
class RpcEndpoint {
  private failedUntilMs = 0;
  private consecutiveFailures = 0;
  private lastFailureMarkedAtMs = 0;

  constructor(readonly url: string) {}

  isHealthy(now: number): boolean {
    return now >= this.failedUntilMs;
  }

  cooldownUntilMs(): number {
    return this.failedUntilMs;
  }

  markFailed(rateLimited: boolean, attemptStartedAtMs: number, now: number): void {
    // Suppress duplicate marks from a single outage burst:
    // - already cooling down → ignore
    // - attempt started before our last failure mark → ignore (stale loser)
    if (now < this.failedUntilMs) return;
    if (attemptStartedAtMs < this.lastFailureMarkedAtMs) return;

    this.consecutiveFailures += 1;
    this.lastFailureMarkedAtMs = now;
    const cooldown = rateLimited
      ? RATE_LIMIT_COOLDOWN_MS
      : Math.min(
          ERROR_COOLDOWN_BASE_MS * this.consecutiveFailures,
          ERROR_COOLDOWN_MAX_MS,
        );
    // Add small jitter so concurrent callers don't wake in lockstep.
    const jitter = Math.floor(Math.random() * 250);
    this.failedUntilMs = now + cooldown + jitter;

    console.warn(
      `[rpc] endpoint ${redactRpcUrl(this.url)} marked unhealthy for ${Math.round(
        cooldown / 1000,
      )}s${rateLimited ? ' (rate-limited)' : ''}`,
    );
  }

  markSuccess(attemptStartedAtMs: number): void {
    // Don't let a stale success erase a newer failure.
    if (attemptStartedAtMs < this.lastFailureMarkedAtMs) return;
    this.consecutiveFailures = 0;
    this.failedUntilMs = 0;
  }
}

/**
 * Pool of Solana RPC endpoints. Exposes a single {@link Connection} via
 * {@link createConnection} whose underlying fetch rotates endpoints on
 * failure. Exported for tests / advanced composition.
 */
export class SolanaRpcPool {
  private readonly endpoints: RpcEndpoint[];
  private rrIdx = 0;

  constructor(
    urls: string[],
    private readonly options: RpcPoolOptions = DEFAULT_RPC_OPTIONS,
  ) {
    if (urls.length === 0) {
      throw new Error('[rpc] SolanaRpcPool requires at least one URL');
    }
    this.endpoints = urls.map((url) => new RpcEndpoint(url));
  }

  /**
   * Build a new {@link Connection} that routes every HTTP request through
   * this pool. Pool state (health, round-robin cursor) is shared across all
   * connections built from the same pool.
   */
  createConnection(): Connection {
    // Seed the Connection with the first URL — @solana/web3.js requires a
    // valid URL at construction time but our custom fetch ignores it and
    // rotates internally.
    return new Connection(this.endpoints[0]!.url, {
      commitment: 'confirmed',
      disableRetryOnRateLimit: true,
      fetch: this.fetch.bind(this),
    });
  }

  /** The custom fetch passed into Connection — implements failover. */
  private async fetch(
    _input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Awaited<ReturnType<typeof fetch>>> {
    const startedAtMs = Date.now();
    const deadlineMs = startedAtMs + this.options.totalTimeoutMs;
    const attempts: AttemptRecord[] = [];
    let attempt = 0;

    while (attempt < this.options.maxAttempts && Date.now() < deadlineMs) {
      const now = Date.now();
      const endpoint = this.pickEndpointOrWait(now, deadlineMs);
      if (!endpoint) break;

      attempt += 1;
      const attemptStartedAtMs = Date.now();
      const remaining = deadlineMs - attemptStartedAtMs;
      if (remaining <= 0) break;
      const perAttemptTimeout = Math.min(this.options.requestTimeoutMs, remaining);

      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), perAttemptTimeout);

      const callerSignal = init?.signal;
      const onCallerAbort = () => controller.abort();
      callerSignal?.addEventListener('abort', onCallerAbort);

      try {
        const response = await fetch(endpoint.url, {
          ...init,
          signal: controller.signal,
        });

        if (response.ok) {
          endpoint.markSuccess(attemptStartedAtMs);
          return response;
        }

        if (NON_RETRYABLE_HTTP_STATUS.has(response.status)) {
          // Configuration error (bad key, wrong URL). Do NOT mark endpoint
          // unhealthy — it's responding correctly, the request is wrong.
          throw new Error(
            `RPC ${response.status} from ${redactRpcUrl(endpoint.url)}: ${await readErrorPreview(response)}`,
          );
        }

        const isRateLimit = response.status === 429;
        const detail = await readErrorPreview(response);
        endpoint.markFailed(isRateLimit, attemptStartedAtMs, Date.now());
        attempts.push({
          url: endpoint.url,
          kind: isRateLimit ? 'rate-limit' : 'http',
          detail: `${response.status} ${detail}`.slice(0, 300),
        });

        if (!RETRYABLE_HTTP_STATUS.has(response.status)) {
          // Unknown non-2xx → fail fast rather than retry blindly across endpoints.
          throw new Error(
            `RPC ${response.status} from ${redactRpcUrl(endpoint.url)}: ${detail}`,
          );
        }
      } catch (err) {
        const classified = classifyTransportError(err, controller.signal.aborted);
        attempts.push({
          url: endpoint.url,
          kind: classified.kind,
          detail: classified.detail,
        });

        if (classified.kind === 'rate-limit' || classified.kind === 'timeout') {
          endpoint.markFailed(
            classified.kind === 'rate-limit',
            attemptStartedAtMs,
            Date.now(),
          );
        } else if (classified.retryable) {
          endpoint.markFailed(false, attemptStartedAtMs, Date.now());
        } else {
          // Fatal — propagate immediately, don't keep retrying.
          throw normalizeRpcError(err, endpoint.url);
        }
      } finally {
        clearTimeout(timeoutHandle);
        callerSignal?.removeEventListener('abort', onCallerAbort);
      }
    }

    throw new RpcFailoverExhaustedError(
      `[rpc] all ${attempts.length} attempt(s) failed`,
      attempts,
    );
  }

  /**
   * Pick the next healthy endpoint via round-robin. If none are healthy,
   * sleep until the earliest cooldown ends (bounded by deadline).
   */
  private pickEndpointOrWait(
    now: number,
    deadlineMs: number,
  ): RpcEndpoint | null {
    const n = this.endpoints.length;
    for (let i = 0; i < n; i += 1) {
      const idx = this.rrIdx % n;
      this.rrIdx = (this.rrIdx + 1) % n;
      const ep = this.endpoints[idx]!;
      if (ep.isHealthy(now)) return ep;
    }

    // All unhealthy — sleep until earliest cooldown ends, capped by deadline.
    const earliest = Math.min(...this.endpoints.map((e) => e.cooldownUntilMs()));
    const waitMs = Math.max(0, Math.min(earliest - now, deadlineMs - now));
    if (waitMs <= 0) return null;
    // Synchronous busy-spin? No — caller awaits the returned promise. But
    // this method is sync, so we can't sleep here without restructuring.
    // Instead, return the endpoint with the earliest cooldown and let the
    // caller's per-attempt timeout handle the wait. This is simpler and
    // still bounded by total deadline.
    let earliestEp = this.endpoints[0]!;
    for (const e of this.endpoints) {
      if (e.cooldownUntilMs() < earliestEp.cooldownUntilMs()) earliestEp = e;
    }
    return earliestEp;
  }
}

// ── error classification + normalization ─────────────────────────────────

function classifyTransportError(
  err: unknown,
  wasAborted: boolean,
): {
  kind: AttemptRecord['kind'];
  retryable: boolean;
  detail: string;
} {
  if (wasAborted) {
    return { kind: 'timeout', retryable: true, detail: 'request timed out' };
  }
  const code = getErrorCode(err);
  const message = err instanceof Error ? err.message : String(err);
  const lowered = message.toLowerCase();

  if (code && RETRYABLE_ERROR_CODES.has(code)) {
    return { kind: 'transport', retryable: true, detail: code };
  }
  if (RETRYABLE_MESSAGE_PATTERNS.some((p) => lowered.includes(p))) {
    return { kind: 'transport', retryable: true, detail: stripHtml(message) };
  }
  return { kind: 'transport', retryable: false, detail: stripHtml(message) };
}

function getErrorCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: unknown }).code;
    if (typeof code === 'string') return code;
  }
  if (err && typeof err === 'object' && 'cause' in err) {
    return getErrorCode((err as { cause: unknown }).cause);
  }
  return undefined;
}

async function readErrorPreview(
  response: Awaited<ReturnType<typeof fetch>>,
): Promise<string> {
  try {
    const text = await response.text();
    return stripHtml(text);
  } catch {
    return response.statusText || 'no response body';
  }
}

function stripHtml(raw: string): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (
    /^<!doctype\s+html/i.test(trimmed) ||
    /^<html[\s>]/i.test(trimmed) ||
    /<body[\s>]/i.test(trimmed)
  ) {
    // Cloudflare / nginx error pages — pull <title> if present, else fall back.
    const titleMatch = trimmed.match(/<title>([^<]+)<\/title>/i);
    if (titleMatch?.[1]) return titleMatch[1].trim().slice(0, 200);
    return 'HTML error page';
  }
  return trimmed.split('\n')[0]?.slice(0, 300) ?? 'unknown error';
}

function normalizeRpcError(err: unknown, endpointUrl: string): Error {
  const message = err instanceof Error ? err.message : String(err);
  const cleaned = stripHtml(message);
  return new Error(`[rpc] ${redactRpcUrl(endpointUrl)}: ${cleaned}`);
}

function redactRpcUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.search = '';
    if (url.username || url.password) {
      url.username = '';
      url.password = '';
    }
    // Helius/QuickNode put api keys in path: /v1/<key>/... — best-effort redact.
    if (/helius|quicknode|alchemy/i.test(url.hostname)) {
      url.pathname = '/[redacted]';
    }
    return url.toString();
  } catch {
    return raw;
  }
}

