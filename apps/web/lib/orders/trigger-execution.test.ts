import assert from 'node:assert/strict';
import test from 'node:test';
import type { TriggerHitPayload } from '@hunch-it/shared';
import type { SwapResult } from '@/lib/jupiter/ultra-swap';
import type { ClientDiagnosticInput } from '@/lib/dev-tools/client-diagnostics';
import { executeTriggerOrder } from './trigger-execution';

const buyPayload: TriggerHitPayload = {
  orderId: 'order-1',
  positionId: 'position-1',
  ticker: 'SPYx',
  mint: 'mint-spyx',
  kind: 'BUY_TRIGGER',
  side: 'BUY',
  triggerPriceUsd: 100,
  currentPriceUsd: 100,
  sizeUsd: 25,
  tokenAmount: null,
};

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function swapResult(): SwapResult {
  return {
    order: {
      requestId: 'request-1234567890abcdef',
      transaction: 'unsigned-tx',
      inAmount: '25000000',
      outAmount: '20000000',
      otherAmountThreshold: '19000000',
      priceImpactPct: '0',
    },
    exec: {
      status: 'Success',
      signature: 'signature-1234567890abcdef',
    },
    inputMint: 'usdc-mint',
    outputMint: 'mint-spyx',
    inputAmount: '25000000',
    outputAmount: '20000000',
    debug: {
      phase: 'execute',
      direction: 'BUY',
      xStockMint: 'mint-spyx',
      inputMint: 'usdc-mint',
      outputMint: 'mint-spyx',
      amount: '25000000',
      taker: 'taker-1',
      orderRequestId: 'request-1234567890abcdef',
      orderInAmount: '25000000',
      orderOutAmount: '20000000',
      otherAmountThreshold: '19000000',
      priceImpactPct: '0',
      diagnosticsSource: 'trigger-toast',
      selectedPrivyRpc: null,
      rpcUrls: [],
      orderFetchedAt: null,
      orderLatencyMs: null,
      deserializedAt: null,
      transactionBytes: null,
      transactionShape: null,
      recentBlockhash: null,
      blockhashValidity: null,
      preBroadcastSimulation: null,
      broadcastStartedAt: null,
      broadcastEndedAt: null,
      broadcastLatencyMs: null,
      orderAgeMsAtBroadcast: null,
      orderAgeBucket: 'unknown',
      signedTransactionBytes: null,
      signedTransactionShape: null,
      executeStatus: 'Success',
      executeError: null,
      signature: 'signature-1234567890abcdef',
      sellBalance: null,
      originalMessage: '',
    },
  };
}

test('executeTriggerOrder diagnostics include BUY execution economics without full signature', async () => {
  const emitted: ClientDiagnosticInput[] = [];
  const outcome = await executeTriggerOrder(
    { payload: buyPayload, mint: 'mint-spyx', decimals: 8, startedAt: 0 },
    {
      authedFetch: async (input, init) => {
        if (String(input).endsWith('/execution-claim') && init?.method === 'POST') {
          return okJson({ ok: true });
        }
        if (String(input).endsWith('/execute') && init?.method === 'POST') {
          return okJson({ ok: true });
        }
        if (String(input) === '/api/portfolio?freshBalances=1') {
          return okJson({
            cashUsd: 5,
            positions: [
              {
                id: 'position-1',
                ticker: 'SPYx',
                tokenAmount: 0.2,
                avgCost: 125,
                markPrice: 100,
                pnl: -5,
                state: 'ACTIVE',
              },
            ],
            pnl: { realized: 0, unrealized: -5 },
          });
        }
        return new Response(JSON.stringify({ error: 'unexpected request' }), { status: 500 });
      },
      swap: async () => swapResult(),
      emitDiagnostic: (input) => {
        emitted.push(input);
      },
    },
  );

  assert.equal(outcome.kind, 'settled');
  const settled = emitted.find((entry) => entry.step === 'trigger.executeSwap');
  const response = settled?.response as
    | { executionEvidence?: unknown; portfolioSummary?: unknown }
    | undefined;
  assert.deepEqual(response?.executionEvidence, {
    orderId: 'order-1',
    positionId: 'position-1',
    ticker: 'SPYx',
    kind: 'BUY_TRIGGER',
    side: 'BUY',
    triggerPriceUsd: 100,
    currentPriceUsd: 100,
    sizeUsd: 25,
    ultraInAmount: '25000000',
    ultraOutAmount: '20000000',
    decimals: 8,
    executionPrice: 125,
    tokenAmount: 0.2,
    usdValue: 25,
    premiumVsCurrentPricePct: 25,
    premiumVsTriggerPricePct: 25,
    jupiterRequestId: 'requ...cdef',
    txSignature: 'sign...cdef',
  });
  assert.deepEqual(response?.portfolioSummary, {
    cashUsd: 5,
    activePositions: 1,
    realizedPnl: 0,
    unrealizedPnl: -5,
    totalPnl: -5,
    positionsValue: 20,
    totalValue: 25,
  });
});
