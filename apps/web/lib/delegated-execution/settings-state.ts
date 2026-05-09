export const DELEGATED_ACCESS_TIMEOUT_MS = 45_000;
export const DELEGATED_ACCESS_REVOKE_TIMEOUT_MS = 15_000;
export const DELEGATED_ACCESS_REVOKE_POLL_MS = 1_000;
export const STALE_SIGNER_ENV_ERROR = 'stale_privy_authorization_signer_client_env';

export type DelegatedExecutionSettingsStatus =
  | {
      ok: true;
      serverKey: { configured: boolean; env: string };
      serverSigner: { configured: boolean; walletMatched: boolean; env: string[] };
      wallet: {
        delegated: boolean | null;
        privyWalletId: string | null;
        walletClientType: string | null;
        resolveError: string | null;
      };
      ready: { canExecute: boolean; blockers: string[] };
    }
  | { ok: false; error: string };

export interface AutoExecuteSettingsState {
  grantActive: boolean;
  ready: boolean;
  statusLabel: string;
  statusTone: 'error' | 'ready' | 'setup' | 'off';
  detail: string;
  blockerLabel: string | null;
  primaryAction: 'enable' | 'disable';
}

export function deriveAutoExecuteSettingsState(input: {
  connected: boolean;
  loading: boolean;
  status: DelegatedExecutionSettingsStatus | null;
  clientDelegated?: boolean | null;
}): AutoExecuteSettingsState {
  const serverGrantActive =
    input.status?.ok === true &&
    (input.status.wallet.delegated === true || input.status.serverSigner.walletMatched === true);
  const clientGrantActive =
    input.clientDelegated === true && (input.status == null || input.status.ok === false);
  const grantActive = serverGrantActive || clientGrantActive;
  const ready = input.status?.ok === true && input.status.ready.canExecute;

  const statusLabel = !input.connected
    ? 'Signed out'
    : input.loading
      ? 'Checking'
      : input.status?.ok === false
        ? 'Check failed'
        : ready
          ? 'Live'
          : grantActive
            ? 'Needs setup'
            : 'Manual';

  const statusTone =
    input.status?.ok === false ? 'error' : ready ? 'ready' : grantActive ? 'setup' : 'off';

  const detail = !input.connected
    ? 'Sign in to manage delegated trigger execution.'
    : ready
      ? 'Hunch can fill accepted BUY, TP, and SL triggers when prices hit.'
      : input.status?.ok === false
        ? grantActive
          ? 'Delegation is present locally, but server readiness could not be checked.'
          : 'Could not read delegated wallet status.'
        : grantActive
          ? 'Delegation exists, but server readiness is incomplete.'
          : 'Triggers will keep using manual Execute prompts.';

  const blockerLabel =
    grantActive && input.status?.ok === true && input.status.ready.blockers.length > 0
      ? input.status.ready.blockers.map((item) => item.replaceAll('_', ' ')).join(', ')
      : null;

  return {
    grantActive,
    ready,
    statusLabel,
    statusTone,
    detail,
    blockerLabel,
    primaryAction: grantActive ? 'disable' : 'enable',
  };
}

export function delegatedAccessError(message: string, detail: unknown): Error {
  const err = new Error(message) as Error & { detail?: unknown; status?: number };
  err.name = 'DelegatedAccessError';
  err.status = 408;
  err.detail = detail;
  return err;
}

export interface DelegatedAccessGrantStatus {
  wallet: { delegated: boolean | null };
  serverSigner: { walletMatched: boolean };
}

export function delegatedAccessGrantActive(
  status: DelegatedAccessGrantStatus | null | undefined,
): boolean {
  return status?.wallet.delegated === true || status?.serverSigner.walletMatched === true;
}

export async function withDelegatedAccessTimeout<T>(
  promise: Promise<T>,
  timeoutMs = DELEGATED_ACCESS_TIMEOUT_MS,
  operation: 'enable' | 'revoke' = 'enable',
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              delegatedAccessError(
                operation === 'revoke'
                  ? 'Privy delegated-access revoke did not complete.'
                  : 'Privy delegated-access prompt did not complete.',
                {
                  code:
                    operation === 'revoke'
                      ? 'delegated_access_revoke_timeout'
                      : 'delegated_access_timeout',
                  timeoutMs,
                },
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function compactGrantStatus(status: DelegatedAccessGrantStatus | null): unknown {
  if (!status) return null;
  return {
    wallet: { delegated: status.wallet.delegated },
    serverSigner: { walletMatched: status.serverSigner.walletMatched },
  };
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

export async function waitForDelegatedAccessRevocation<TStatus extends DelegatedAccessGrantStatus>({
  revoke,
  readStatus,
  timeoutMs = DELEGATED_ACCESS_REVOKE_TIMEOUT_MS,
  pollMs = DELEGATED_ACCESS_REVOKE_POLL_MS,
}: {
  revoke: () => Promise<void>;
  readStatus: () => Promise<TStatus>;
  timeoutMs?: number;
  pollMs?: number;
}): Promise<TStatus> {
  const revokeResult: {
    state: 'pending' | 'fulfilled' | 'rejected';
    error?: unknown;
  } = { state: 'pending' };
  const startedAt = Date.now();
  let lastStatus: TStatus | null = null;
  let lastStatusError: unknown;

  void revoke().then(
    () => {
      revokeResult.state = 'fulfilled';
    },
    (err) => {
      revokeResult.state = 'rejected';
      revokeResult.error = err;
    },
  );

  while (Date.now() - startedAt < timeoutMs) {
    try {
      lastStatus = await readStatus();
      lastStatusError = undefined;
      if (!delegatedAccessGrantActive(lastStatus)) return lastStatus;
    } catch (err) {
      lastStatusError = err;
      // Keep waiting on the revoke result; a transient status read should not
      // leave the UI in its disabling state if the next poll succeeds.
    }

    if (revokeResult.state === 'rejected') {
      if (lastStatus && !delegatedAccessGrantActive(lastStatus)) return lastStatus;
      throw toError(revokeResult.error);
    }
    if (revokeResult.state === 'fulfilled' && lastStatusError && !lastStatus) {
      throw toError(lastStatusError);
    }

    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(pollMs, Math.max(0, timeoutMs - (Date.now() - startedAt)))),
    );
  }

  if (revokeResult.state === 'rejected') throw toError(revokeResult.error);
  if (revokeResult.state === 'fulfilled') {
    throw delegatedAccessError(
      'Privy delegated-access revoke completed, but delegated access still appears active.',
      {
        code: 'delegated_access_revoke_still_active',
        timeoutMs,
        lastStatus: compactGrantStatus(lastStatus),
      },
    );
  }

  throw delegatedAccessError('Privy delegated-access revoke did not complete.', {
    code: 'delegated_access_revoke_timeout',
    timeoutMs,
    lastStatus: compactGrantStatus(lastStatus),
  });
}
