import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveAutoExecuteSettingsState,
  withDelegatedAccessTimeout,
  type DelegatedExecutionSettingsStatus,
} from './settings-state';

test('Settings treats local delegation as active when server status check fails', () => {
  const state = deriveAutoExecuteSettingsState({
    connected: true,
    loading: false,
    clientDelegated: true,
    status: { ok: false, error: 'missing_privy_server_credentials' },
  });

  assert.equal(state.grantActive, true);
  assert.equal(state.primaryAction, 'disable');
  assert.equal(state.statusLabel, 'Check failed');
  assert.match(state.detail, /Delegation is present locally/);
});

test('Settings exposes readiness blockers when delegation exists but cannot execute', () => {
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
