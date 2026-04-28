// Upstash Redis REST client. No-op when creds are missing.
import { Redis } from '@upstash/redis';
import { env } from '../env.js';
import type { Signal } from '@hunch-it/shared';

let client: Redis | null = null;

export function getRedis(): Redis | null {
  if (client) return client;
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) return null;
  client = new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  });
  return client;
}

export async function cacheSignal(signal: Signal): Promise<void> {
  const c = getRedis();
  if (!c) return;
  await c.set(`signal:${signal.id}`, JSON.stringify(signal), { ex: signal.ttlSeconds });
}

export async function readSignal(id: string): Promise<Signal | null> {
  const c = getRedis();
  if (!c) return null;
  const raw = await c.get<string>(`signal:${id}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Signal;
  } catch {
    return null;
  }
}

// LLM daily spend counter — keyed by UTC date so it auto-resets at 00:00 UTC.
// Uses Upstash Redis when configured (production / multi-process), otherwise
// falls back to a per-process in-memory map (single dev process). The cap
// gating in signals/llm.ts works either way; Redis just lets multiple
// ws-server instances share the same bucket.
function todayKey(): string {
  return `llm:spend:${new Date().toISOString().slice(0, 10)}`;
}

const memSpend = new Map<string, number>();

export async function getLlmSpendUsd(): Promise<number> {
  const c = getRedis();
  if (!c) return memSpend.get(todayKey()) ?? 0;
  const raw = await c.get<string | number>(todayKey());
  return typeof raw === 'number' ? raw : Number(raw ?? 0);
}

export async function recordLlmSpendUsd(deltaUsd: number): Promise<number> {
  const key = todayKey();
  const c = getRedis();
  if (!c) {
    const next = (memSpend.get(key) ?? 0) + deltaUsd;
    memSpend.set(key, next);
    // Drop yesterday's bucket so memSpend doesn't grow forever.
    for (const k of memSpend.keys()) if (k !== key) memSpend.delete(k);
    return next;
  }
  // incrbyfloat keeps a single source of truth across processes.
  const next = await c.incrbyfloat(key, deltaUsd);
  await c.expire(key, 36 * 3600);
  return Number(next);
}
