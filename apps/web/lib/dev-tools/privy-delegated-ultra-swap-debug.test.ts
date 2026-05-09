import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDelegatedUltraPreflightReport,
  diagnosticsForDelegatedUltraApiError,
} from './privy-delegated-ultra-swap-debug';

test('delegated Ultra preflight reports missing server readiness blockers before execution', () => {
  const report = buildDelegatedUltraPreflightReport({
    connected: true,
    walletAddress: 'So11111111111111111111111111111111111111112',
    clientDelegated: false,
    status: {
      serverKey: { configured: false },
      wallet: { delegated: false, privyWalletId: null, resolveError: null },
      ready: {
        canExecute: false,
        blockers: ['missing_privy_authorization_private_key', 'wallet_not_delegated'],
      },
    },
    order: {
      id: 'order-1',
      kind: 'BUY_TRIGGER',
      side: 'BUY',
      status: 'OPEN',
      ticker: 'AAPLx',
      mint: 'mint-aapl',
      sizeUsd: 25,
      tokenAmount: null,
    },
  });

  assert.equal(report.canAttempt, false);
  assert.deepEqual(report.blockers, [
    'missing_privy_authorization_private_key',
    'wallet_not_delegated',
  ]);
  assert.equal(
    report.diagnostics.some(
      (item) => item.hypothesis === 'Server readiness' && item.status === 'risk',
    ),
    true,
  );
  assert.match(
    report.diagnostics.find((item) => item.hypothesis === 'Order funding')?.detail ?? '',
    /BUY inputs are not balance-capped/,
  );
});

test('delegated Ultra preflight predicts sell order token funding requirement', () => {
  const report = buildDelegatedUltraPreflightReport({
    connected: true,
    walletAddress: 'So11111111111111111111111111111111111111112',
    clientDelegated: true,
    status: {
      serverKey: { configured: true },
      wallet: { delegated: true, privyWalletId: 'wallet-1', resolveError: null },
      ready: { canExecute: true, blockers: [] },
    },
    order: {
      id: 'order-2',
      kind: 'STOP_LOSS',
      side: 'SELL',
      status: 'OPEN',
      ticker: 'TSLAx',
      mint: 'mint-tsla',
      sizeUsd: 50,
      tokenAmount: 1.25,
    },
  });

  assert.equal(report.canAttempt, true);
  assert.deepEqual(report.expectedInput, {
    mint: 'mint-tsla',
    symbol: 'TSLAx',
    amount: '1.25',
    reason: 'STOP_LOSS exits spend the position token before receiving USDC.',
  });
  assert.match(
    report.diagnostics.find((item) => item.hypothesis === 'Order funding')?.detail ?? '',
    /submits the available balance/,
  );
});

test('delegated Ultra API diagnostics explain insufficient funds', () => {
  const diagnostics = diagnosticsForDelegatedUltraApiError({
    message: 'insufficient_funds',
    status: 400,
    detail: {
      inputMint: 'USDC',
      requestedRaw: '25000000',
      walletRaw: '0',
    },
  });

  assert.equal(diagnostics[0]?.hypothesis, 'Funding balance');
  assert.equal(diagnostics[0]?.status, 'risk');
  assert.match(diagnostics[0]?.detail ?? '', /below requested 25000000/);
});

test('delegated Ultra API diagnostics explain Privy server signing failures', () => {
  const diagnostics = diagnosticsForDelegatedUltraApiError({
    message: 'privy_sign_transaction_failed',
    status: 502,
    detail: {
      cause: 'invalid authorization key',
    },
  });

  assert.equal(diagnostics[0]?.hypothesis, 'Privy signing');
  assert.match(diagnostics[0]?.detail ?? '', /wallet delegation policy/);
});
