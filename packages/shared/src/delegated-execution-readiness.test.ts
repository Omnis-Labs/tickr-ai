import assert from 'node:assert/strict';
import test from 'node:test';
import {
  delegatedExecutionReadinessStatus,
  getDelegatedExecutionAuthorizationSignerId,
  type DelegatedExecutionResolvedWallet,
} from './delegated-execution-readiness.js';

const readyWallet: DelegatedExecutionResolvedWallet = {
  walletId: 'wallet-1',
  walletChainType: 'solana',
  delegated: true,
  walletClientType: 'privy-v2',
  connectorType: 'embedded',
  additionalSignerIds: ['signer-1'],
  ownerId: 'user-1',
  policyIds: [],
  authorizationThreshold: null,
  resolveError: null,
};

test('delegated execution readiness passes for a Privy v2 wallet with the configured signer', () => {
  const status = delegatedExecutionReadinessStatus({
    walletAddress: 'wallet-address',
    resolved: readyWallet,
    serverKeyConfigured: true,
    authorizationSignerId: 'signer-1',
  });

  assert.equal(status.ready.canExecute, true);
  assert.deepEqual(status.ready.blockers, []);
  assert.equal(status.serverSigner.walletMatched, true);
});

test('delegated execution readiness reports stable blockers for unsupported signer state', () => {
  const status = delegatedExecutionReadinessStatus({
    walletAddress: 'wallet-address',
    resolved: {
      ...readyWallet,
      walletClientType: 'privy',
      additionalSignerIds: [],
    },
    serverKeyConfigured: false,
    authorizationSignerId: 'signer-1',
  });

  assert.equal(status.ready.canExecute, false);
  assert.deepEqual(status.ready.blockers, [
    'missing_privy_authorization_private_key',
    'unsupported_privy_wallet_client_type',
    'wallet_missing_authorization_signer',
    'wallet_not_delegated',
  ]);
});

test('delegated execution signer id resolution prefers server env over public env', () => {
  const signerId = getDelegatedExecutionAuthorizationSignerId((name) =>
    name === 'PRIVY_WALLET_AUTHORIZATION_SIGNER_ID'
      ? 'server-signer'
      : name === 'NEXT_PUBLIC_PRIVY_WALLET_AUTHORIZATION_SIGNER_ID'
        ? 'public-signer'
        : null,
  );

  assert.equal(signerId, 'server-signer');
});
