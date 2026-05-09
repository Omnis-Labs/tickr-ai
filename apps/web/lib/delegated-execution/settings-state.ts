export const DELEGATED_ACCESS_TIMEOUT_MS = 45_000;
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
  const grantActive = serverGrantActive || input.clientDelegated === true;
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

export async function withDelegatedAccessTimeout<T>(
  promise: Promise<T>,
  timeoutMs = DELEGATED_ACCESS_TIMEOUT_MS,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              delegatedAccessError('Privy delegated-access prompt did not complete.', {
                code: 'delegated_access_timeout',
                timeoutMs,
              }),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
