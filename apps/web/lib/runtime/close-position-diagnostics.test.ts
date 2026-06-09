import assert from 'node:assert/strict';
import test from 'node:test';
import type { SwapResult } from '@/lib/jupiter/ultra-swap';
import { closePositionDiagnosticResponse } from './close-position-diagnostics';

function sellSwapResult(): SwapResult {
  return {
    order: {
      requestId: 'request-1234567890abcdef',
      transaction: 'unsigned-tx',
      inAmount: '20000000',
      outAmount: '24000000',
      otherAmountThreshold: '23000000',
      priceImpactPct: '0',
    },
    exec: {
      status: 'Success',
      signature: 'signature-1234567890abcdef',
    },
    inputMint: 'mint-spyx',
    outputMint: 'usdc-mint',
    inputAmount: '20000000',
    outputAmount: '24000000',
    debug: {
      phase: 'execute',
      direction: 'SELL',
      xStockMint: 'mint-spyx',
      inputMint: 'mint-spyx',
      outputMint: 'usdc-mint',
      amount: '20000000',
      taker: 'taker-1',
      orderRequestId: 'request-1234567890abcdef',
      orderInAmount: '20000000',
      orderOutAmount: '24000000',
      otherAmountThreshold: '23000000',
      priceImpactPct: '0',
      diagnosticsSource: null,
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
      sellBalance: {
        requestedRaw: '20000000',
        walletRaw: '40000000',
        submittedRaw: '20000000',
        tokenProgramIds: [],
        balancePrograms: [],
      },
      originalMessage: '',
    },
  };
}

test('close position diagnostics prove position-scoped sell amount', () => {
  const response = closePositionDiagnosticResponse({
    positionId: 'position-1',
    ticker: 'SPYx',
    decimals: 8,
    requestedTokenAmount: 0.2,
    swap: sellSwapResult(),
    settlement: {
      closeOrderId: 'close-order-1234567890abcdef',
      cancelledExitOrderIds: ['take-profit-1234567890abcdef', 'stop-loss-1234567890abcdef'],
    },
  });

  assert.equal(response.executionEvidence.positionScope, 'position_token_amount');
  assert.equal(response.executionEvidence.requestedRawAmount, '20000000');
  assert.equal(response.executionEvidence.walletRawAmount, '40000000');
  assert.equal(response.executionEvidence.submittedRawAmount, '20000000');
  assert.equal(response.executionEvidence.tokenAmount, 0.2);
  assert.equal(response.executionEvidence.executionPrice, 120);
  assert.deepEqual(response.executionEvidence.cancelledExitOrderIds, [
    'take...cdef',
    'stop...cdef',
  ]);
});
