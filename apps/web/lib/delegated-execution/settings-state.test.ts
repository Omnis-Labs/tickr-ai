import assert from 'node:assert/strict';
import test from 'node:test';
import {
  autoExecuteSecondaryActions,
  deriveAutoExecuteSettingsState,
  waitForDelegatedAccessRevocation,
  withDelegatedAccessTimeout,
  type DelegatedExecutionSettingsStatus,
} from './settings-state';

test('Settings does not treat legacy local delegation metadata as active', () => {
  const state = deriveAutoExecuteSettingsState({
    connected: true,
    loading: false,
    clientDelegated: true,
    status: { ok: false, error: 'missing_privy_server_credentials' },
  });

  assert.equal(state.grantActive, false);
  assert.equal(state.primaryAction, 'enable');
  assert.equal(state.statusLabel, 'Check failed');
  assert.match(state.detail, /Could not read wallet signer status/);
});

test('Settings exposes readiness blockers when signer access exists but cannot execute', () => {
  const status: DelegatedExecutionSettingsStatus = {
    ok: true,
    serverKey: { configured: false, env: 'PRIVY_WALLET_AUTHORIZATION_PRIVATE_KEY' },
    serverSigner: {
      configured: true,
      walletMatched: true,
      env: [
        'PRIVY_WALLET_AUTHORIZATION_SIGNER_ID',
        'NEXT_PUBLIC_PRIVY_WALLET_AUTHORIZATION_SIGNER_ID',
      ],
    },
    wallet: {
      delegated: false,
      privyWalletId: 'wallet-1',
      walletClientType: 'privy-v2',
      resolveError: null,
    },
    ready: {
      canExecute: false,
      blockers: ['missing_privy_authorization_private_key'],
    },
  };

  const state = deriveAutoExecuteSettingsState({
    connected: true,
    loading: false,
    clientDelegated: false,
    status,
  });

  assert.equal(state.grantActive, true);
  assert.equal(state.ready, false);
  assert.equal(state.statusLabel, 'Needs setup');
  assert.equal(state.blockerLabel, 'missing privy authorization private key');
});

test('Settings treats signer metadata on Privy embedded wallets as active', () => {
  const status: DelegatedExecutionSettingsStatus = {
    ok: true,
    serverKey: { configured: true, env: 'PRIVY_WALLET_AUTHORIZATION_PRIVATE_KEY' },
    serverSigner: {
      configured: true,
      walletMatched: true,
      env: [
        'PRIVY_WALLET_AUTHORIZATION_SIGNER_ID',
        'NEXT_PUBLIC_PRIVY_WALLET_AUTHORIZATION_SIGNER_ID',
      ],
    },
    wallet: {
      delegated: true,
      privyWalletId: 'wallet-legacy',
      walletClientType: 'privy',
      resolveError: null,
    },
    ready: {
      canExecute: false,
      blockers: ['missing_privy_authorization_private_key'],
    },
  };

  const state = deriveAutoExecuteSettingsState({
    connected: true,
    loading: false,
    clientDelegated: true,
    status,
  });

  assert.equal(state.grantActive, true);
  assert.equal(state.primaryAction, 'disable');
  assert.equal(state.statusLabel, 'Needs setup');
  assert.equal(state.blockerLabel, 'missing privy authorization private key');
});

test('Settings trusts server status over stale local delegated metadata', () => {
  const status: DelegatedExecutionSettingsStatus = {
    ok: true,
    serverKey: { configured: true, env: 'PRIVY_WALLET_AUTHORIZATION_PRIVATE_KEY' },
    serverSigner: {
      configured: true,
      walletMatched: false,
      env: [
        'PRIVY_WALLET_AUTHORIZATION_SIGNER_ID',
        'NEXT_PUBLIC_PRIVY_WALLET_AUTHORIZATION_SIGNER_ID',
      ],
    },
    wallet: {
      delegated: false,
      privyWalletId: 'wallet-1',
      walletClientType: 'privy-v2',
      resolveError: null,
    },
    ready: {
      canExecute: false,
      blockers: ['wallet_not_delegated'],
    },
  };

  const state = deriveAutoExecuteSettingsState({
    connected: true,
    loading: false,
    clientDelegated: true,
    status,
  });

  assert.equal(state.grantActive, false);
  assert.equal(state.primaryAction, 'enable');
  assert.equal(state.statusLabel, 'Manual');
});

test('Settings secondary actions avoid a duplicate enable path', () => {
  assert.deepEqual(autoExecuteSecondaryActions({ primaryAction: 'enable' }), ['check']);
  assert.deepEqual(autoExecuteSecondaryActions({ primaryAction: 'disable' }), ['check', 'revoke']);
});

test('delegated access enable path times out with an actionable error', async () => {
  await assert.rejects(
    withDelegatedAccessTimeout(new Promise(() => undefined), 5),
    (err: unknown) => {
      assert.equal(err instanceof Error, true);
      assert.equal((err as Error).message, 'Privy delegated-access prompt did not complete.');
      assert.deepEqual((err as Error & { detail?: unknown }).detail, {
        code: 'delegated_access_timeout',
        timeoutMs: 5,
      });
      return true;
    },
  );
});

test('delegated access revoke path times out with revoke-specific detail', async () => {
  await assert.rejects(
    withDelegatedAccessTimeout(new Promise(() => undefined), 5, 'revoke'),
    (err: unknown) => {
      assert.equal(err instanceof Error, true);
      assert.equal((err as Error).message, 'Privy delegated-access revoke did not complete.');
      assert.deepEqual((err as Error & { detail?: unknown }).detail, {
        code: 'delegated_access_revoke_timeout',
        timeoutMs: 5,
      });
      return true;
    },
  );
});

test('delegated access revoke resolves when status shows the grant is already gone', async () => {
  let reads = 0;
  const status = await waitForDelegatedAccessRevocation({
    revoke: () => new Promise(() => undefined),
    readStatus: async () => {
      reads += 1;
      return {
        wallet: { delegated: true, walletClientType: 'privy' },
        serverSigner: { walletMatched: reads === 1 },
      };
    },
    timeoutMs: 50,
    pollMs: 1,
  });

  assert.equal(reads, 2);
  assert.equal(status.wallet.delegated, true);
  assert.equal(status.serverSigner.walletMatched, false);
});
