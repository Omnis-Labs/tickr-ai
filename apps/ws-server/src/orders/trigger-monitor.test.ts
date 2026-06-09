import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@hunch-it/db';
import {
  executableTriggerDecision,
  WsServerEvents,
  type PriceSnapshot,
} from '@hunch-it/shared';
import type { Server as IoServer } from 'socket.io';
import { clearDelegatedExecutionCooldownForTests, runTriggerMonitor } from './trigger-monitor.js';

function decimal(value: number): { toNumber: () => number } {
  return { toNumber: () => value };
}

function openOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    userId: 'user-1',
    positionId: 'position-1',
    kind: 'BUY_TRIGGER',
    side: 'BUY',
    status: 'OPEN',
    triggerPriceUsd: decimal(100),
    sizeUsd: decimal(25),
    tokenAmount: null,
    jupiterOrderId: null,
    user: { walletAddress: 'wallet-1' },
    position: { ticker: 'AAPLx', mint: 'mint-aapl' },
    ...overrides,
  };
}

function prismaWithOrders(orders: unknown[]): PrismaClient {
  return {
    order: {
      findMany: async () => orders,
    },
  } as unknown as PrismaClient;
}

function ioRecorder() {
  const events: Array<{ room: string; event: string; payload: unknown }> = [];
  const io = {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => {
        events.push({ room, event, payload });
      },
    }),
  } as unknown as IoServer;
  return { io, events };
}

async function priceFetcher(): Promise<Map<string, PriceSnapshot>> {
  return new Map([['AAPLx', { ticker: 'AAPLx', price: 100, confidence: 0.01, publishTime: 1 }]]);
}

async function triggerableQuote({ payload }: { payload: Parameters<typeof executableTriggerDecision>[0]['payload'] }) {
  return executableTriggerDecision({
    payload,
    inAmount: '25000000',
    outAmount: '25000000',
    decimals: 8,
  });
}

test('runTriggerMonitor keeps an order open when Pyth wakes it but Ultra BUY price is above trigger', async () => {
  clearDelegatedExecutionCooldownForTests();
  const { io, events } = ioRecorder();
  let delegatedCalls = 0;

  const summary = await runTriggerMonitor(prismaWithOrders([openOrder()]), io, {
    priceFetcher: async () =>
      new Map([['AAPLx', { ticker: 'AAPLx', price: 100.4, confidence: 0.01, publishTime: 1 }]]),
    quoteExecutableTrigger: async ({ payload }) =>
      executableTriggerDecision({
        payload,
        inAmount: '25000000',
        outAmount: '20000000',
        decimals: 8,
      }),
    delegatedExecutor: async () => {
      delegatedCalls += 1;
      throw new Error('delegated execution should not run while executable price waits');
    },
  });

  assert.equal(summary.hits, 0);
  assert.equal(summary.quoteWaiting, 1);
  assert.equal(delegatedCalls, 0);
  assert.equal(events.length, 0);
});

test('runTriggerMonitor emits trade:filled after delegated execution settles', async () => {
  clearDelegatedExecutionCooldownForTests();
  const { io, events } = ioRecorder();

  const summary = await runTriggerMonitor(prismaWithOrders([openOrder()]), io, {
    priceFetcher,
    quoteExecutableTrigger: triggerableQuote,
    delegatedExecutor: async ({ payload }) => ({
      kind: 'settled',
      orderId: payload.orderId,
      positionId: payload.positionId,
      ticker: payload.ticker,
      orderKind: payload.kind,
      signature: 'sig-1',
      executionPrice: 100,
      tokenAmount: 0.25,
      usdValue: 25,
      executionEvidence: {
        orderId: payload.orderId,
        positionId: payload.positionId,
        ticker: payload.ticker,
        kind: payload.kind,
        side: payload.side,
        triggerPriceUsd: payload.triggerPriceUsd,
        currentPriceUsd: payload.currentPriceUsd,
        sizeUsd: payload.sizeUsd,
        ultraInAmount: '25000000',
        ultraOutAmount: '25000000',
        decimals: 8,
        executionPrice: 100,
        tokenAmount: 0.25,
        usdValue: 25,
        premiumVsCurrentPricePct: 0,
        premiumVsTriggerPricePct: 0,
        jupiterRequestId: 'request-1',
        txSignature: 'sig-1',
      },
    }),
  });

  assert.equal(summary.hits, 1);
  assert.equal(summary.delegatedSettled, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.room, 'user:wallet-1');
  assert.equal(events[0]?.event, WsServerEvents.TradeFilled);
  assert.deepEqual(events[0]?.payload, {
    orderId: 'order-1',
    positionId: 'position-1',
    ticker: 'AAPLx',
    kind: 'BUY_TRIGGER',
    side: 'BUY',
    executionMode: 'delegated',
    executionPrice: 100,
    tokenAmount: 0.25,
    usdValue: 25,
    txSignature: 'sig-1',
  });
});

test('runTriggerMonitor falls back to trigger:hit when delegation is unavailable', async () => {
  clearDelegatedExecutionCooldownForTests();
  const { io, events } = ioRecorder();

  const summary = await runTriggerMonitor(prismaWithOrders([openOrder()]), io, {
    priceFetcher,
    quoteExecutableTrigger: triggerableQuote,
    delegatedExecutor: async ({ payload }) => ({
      kind: 'notAvailable',
      orderId: payload.orderId,
      reason: 'wallet_not_delegated',
    }),
  });

  assert.equal(summary.hits, 1);
  assert.equal(summary.delegatedFallbacks, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.event, WsServerEvents.TriggerHit);
});

test('runTriggerMonitor suppresses manual fallback when delegated execution quote waits', async () => {
  clearDelegatedExecutionCooldownForTests();
  const { io, events } = ioRecorder();

  const summary = await runTriggerMonitor(prismaWithOrders([openOrder()]), io, {
    priceFetcher,
    quoteExecutableTrigger: triggerableQuote,
    delegatedExecutor: async ({ payload }) => {
      const decision = executableTriggerDecision({
        payload,
        inAmount: '25000000',
        outAmount: '20000000',
        decimals: 8,
      });
      if (decision.kind !== 'waiting') {
        throw new Error('test quote should wait');
      }
      return {
        kind: 'quoteWaiting',
        orderId: payload.orderId,
        reason: decision.reason,
        executionEvidence: decision.executionEvidence,
      };
    },
  });

  assert.equal(summary.hits, 1);
  assert.equal(summary.delegatedSuppressed, 1);
  assert.equal(events.length, 0);
});

test('runTriggerMonitor suppresses manual fallback after unreleased pre-broadcast failure', async () => {
  clearDelegatedExecutionCooldownForTests();
  const { io, events } = ioRecorder();

  const summary = await runTriggerMonitor(prismaWithOrders([openOrder()]), io, {
    priceFetcher,
    quoteExecutableTrigger: triggerableQuote,
    delegatedExecutor: async ({ payload }) => ({
      kind: 'preBroadcastFailed',
      orderId: payload.orderId,
      reason: 'claim_release_failed',
      shouldCooldown: true,
      released: false,
    }),
  });

  assert.equal(summary.hits, 1);
  assert.equal(summary.delegatedFailures, 1);
  assert.equal(events.length, 0);
});

test('runTriggerMonitor suppresses manual fallback after ambiguous Ultra execute', async () => {
  clearDelegatedExecutionCooldownForTests();
  const { io, events } = ioRecorder();

  const summary = await runTriggerMonitor(prismaWithOrders([openOrder()]), io, {
    priceFetcher,
    quoteExecutableTrigger: triggerableQuote,
    delegatedExecutor: async ({ payload }) => ({
      kind: 'broadcastUnknown',
      orderId: payload.orderId,
      reason: 'delegated_execute_signature_unknown',
      requestId: 'request-1',
    }),
  });

  assert.equal(summary.hits, 1);
  assert.equal(summary.delegatedFailures, 1);
  assert.equal(events.length, 0);
});

test('runTriggerMonitor uses manual fallback during delegated runtime cooldown', async () => {
  clearDelegatedExecutionCooldownForTests();
  const { io, events } = ioRecorder();
  let calls = 0;

  await runTriggerMonitor(prismaWithOrders([openOrder()]), io, {
    priceFetcher,
    quoteExecutableTrigger: triggerableQuote,
    nowMs: () => 1_000,
    delegatedRuntimeCooldownMs: 60_000,
    delegatedExecutor: async ({ payload }) => {
      calls += 1;
      return {
        kind: 'preBroadcastFailed',
        orderId: payload.orderId,
        reason: 'jupiter_runtime',
        shouldCooldown: true,
        released: true,
      };
    },
  });

  await runTriggerMonitor(prismaWithOrders([openOrder()]), io, {
    priceFetcher,
    quoteExecutableTrigger: triggerableQuote,
    nowMs: () => 2_000,
    delegatedRuntimeCooldownMs: 60_000,
    delegatedExecutor: async () => {
      calls += 1;
      throw new Error('cooldown should skip delegated executor');
    },
  });

  assert.equal(calls, 1);
  assert.equal(events.length, 2);
  assert.equal(events[0]?.event, WsServerEvents.TriggerHit);
  assert.equal(events[1]?.event, WsServerEvents.TriggerHit);
});
