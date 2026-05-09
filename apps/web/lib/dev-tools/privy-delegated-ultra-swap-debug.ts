export type DelegatedUltraDiagnosticStatus = 'healthy' | 'watch' | 'risk' | 'unknown';

export interface DelegatedUltraDiagnostic {
  hypothesis: string;
  status: DelegatedUltraDiagnosticStatus;
  detail: string;
}

export interface DelegatedUltraDebugStatus {
  serverKey?: {
    configured?: boolean;
  };
  serverSigner?: {
    configured?: boolean;
    walletMatched?: boolean;
  };
  wallet?: {
    delegated?: boolean | null;
    privyWalletId?: string | null;
    walletClientType?: string | null;
    connectorType?: string | null;
    additionalSignerIds?: string[];
    resolveError?: string | null;
  };
  ready?: {
    canExecute?: boolean;
    blockers?: string[];
  };
}

export interface DelegatedUltraDebugOrder {
  id: string;
  kind: string;
  side: string;
  status: string;
  ticker: string;
  mint: string;
  sizeUsd: number;
  tokenAmount: number | null;
}

export interface DelegatedUltraPreflightInput {
  connected: boolean;
  walletAddress: string | null;
  clientDelegated: boolean | null | undefined;
  status: DelegatedUltraDebugStatus | null;
  order: DelegatedUltraDebugOrder | null;
}

export interface DelegatedUltraPreflightReport {
  ok: true;
  canAttempt: boolean;
  blockers: string[];
  expectedInput: {
    mint: string;
    symbol: string;
    amount: string;
    reason: string;
  } | null;
  wallet: {
    connected: boolean;
    address: string | null;
    clientDelegated: boolean | null;
    serverDelegated: boolean | null;
    privyWalletId: string | null;
  };
  order: {
    id: string;
    kind: string;
    ticker: string;
    status: string;
    side: string;
  } | null;
  diagnostics: DelegatedUltraDiagnostic[];
}

function shortAmount(value: number): string {
  if (!Number.isFinite(value)) return 'unknown amount';
  return value.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

function isSupportedOrder(order: DelegatedUltraDebugOrder): boolean {
  return ['BUY_TRIGGER', 'TAKE_PROFIT', 'STOP_LOSS'].includes(order.kind);
}

function expectedInputForOrder(
  order: DelegatedUltraDebugOrder | null,
): DelegatedUltraPreflightReport['expectedInput'] {
  if (!order) return null;
  if (order.kind === 'BUY_TRIGGER') {
    return {
      mint: 'USDC',
      symbol: 'USDC',
      amount: `$${shortAmount(order.sizeUsd)}`,
      reason: 'BUY triggers spend USDC before receiving the target token.',
    };
  }
  return {
    mint: order.mint,
    symbol: order.ticker,
    amount: shortAmount(order.tokenAmount ?? 0),
    reason: `${order.kind} exits spend the position token before receiving USDC.`,
  };
}

export function buildDelegatedUltraPreflightReport(
  input: DelegatedUltraPreflightInput,
): DelegatedUltraPreflightReport {
  const diagnostics: DelegatedUltraDiagnostic[] = [];
  const blockers: string[] = [];
  const statusBlockers = input.status?.ready?.blockers ?? [];
  const serverDelegated = input.status?.wallet?.delegated ?? null;
  const serverSignerMatched = input.status?.serverSigner?.walletMatched === true;
  const serverCanSign = serverDelegated === true || serverSignerMatched;
  const clientDelegated = input.clientDelegated ?? null;
  const expectedInput = expectedInputForOrder(input.order);

  if (!input.connected || !input.walletAddress) {
    blockers.push('wallet_not_connected');
    diagnostics.push({
      hypothesis: 'Wallet session',
      status: 'risk',
      detail: 'Connect the embedded Solana wallet before testing server-key execution.',
    });
  } else {
    diagnostics.push({
      hypothesis: 'Wallet session',
      status: 'healthy',
      detail: `Connected wallet ${input.walletAddress}.`,
    });
  }

  if (!input.order) {
    blockers.push('no_order_selected');
    diagnostics.push({
      hypothesis: 'Selected order',
      status: 'risk',
      detail: 'Choose an open BUY_TRIGGER, TAKE_PROFIT, or STOP_LOSS order.',
    });
  } else if (input.order.status !== 'OPEN') {
    blockers.push('order_not_open');
    diagnostics.push({
      hypothesis: 'Selected order',
      status: 'risk',
      detail: `Order is ${input.order.status}; delegated execution expects an OPEN order.`,
    });
  } else if (!isSupportedOrder(input.order)) {
    blockers.push('unsupported_order_kind');
    diagnostics.push({
      hypothesis: 'Selected order',
      status: 'risk',
      detail: `${input.order.kind} is not wired into the delegated Ultra experiment.`,
    });
  } else {
    diagnostics.push({
      hypothesis: 'Selected order',
      status: 'healthy',
      detail: `${input.order.kind} ${input.order.ticker} is open and supported.`,
    });
  }

  if (input.order) {
    if (
      input.order.kind !== 'BUY_TRIGGER' &&
      (!input.order.tokenAmount || input.order.tokenAmount <= 0)
    ) {
      blockers.push('sell_trigger_missing_token_amount');
      diagnostics.push({
        hypothesis: 'Order funding',
        status: 'risk',
        detail:
          'Exit orders need tokenAmount so the server can ask Ultra for the right input size.',
      });
    } else if (expectedInput) {
      diagnostics.push({
        hypothesis: 'Order funding',
        status: 'watch',
        detail: `${expectedInput.reason} Fund at least ${expectedInput.amount} ${expectedInput.symbol}; the server preflights raw balance before asking Ultra.`,
      });
    }
  } else {
    diagnostics.push({
      hypothesis: 'Order funding',
      status: 'unknown',
      detail: 'Funding requirement depends on the selected order.',
    });
  }

  if (!input.status) {
    diagnostics.push({
      hypothesis: 'Server readiness',
      status: 'watch',
      detail: 'Delegation status has not been fetched yet; Execute swap will fetch it first.',
    });
  } else if (statusBlockers.length > 0) {
    blockers.push(...statusBlockers);
    diagnostics.push({
      hypothesis: 'Server readiness',
      status: 'risk',
      detail: `Blocked by ${statusBlockers.join(', ')}.`,
    });
  } else {
    diagnostics.push({
      hypothesis: 'Server readiness',
      status: 'healthy',
      detail: 'Server key, Privy wallet lookup, and delegation checks are ready.',
    });
  }

  if (serverCanSign) {
    diagnostics.push({
      hypothesis: 'Privy delegation',
      status: 'healthy',
      detail: serverSignerMatched
        ? 'Server sees the configured authorization signer on the embedded Solana wallet.'
        : 'Server sees delegated access on the embedded Solana wallet.',
    });
  } else if (serverDelegated === false) {
    diagnostics.push({
      hypothesis: 'Privy delegation',
      status: 'risk',
      detail: 'Use Enable in Delegated access, then Check until the server also sees delegation.',
    });
  } else if (clientDelegated === true) {
    diagnostics.push({
      hypothesis: 'Privy delegation',
      status: 'watch',
      detail: 'Client reports delegation, but the server has not resolved it yet.',
    });
  } else {
    diagnostics.push({
      hypothesis: 'Privy delegation',
      status: 'watch',
      detail: input.status?.wallet?.resolveError
        ? `Privy lookup returned: ${input.status.wallet.resolveError}.`
        : 'Delegation is unknown until the server resolves the linked embedded wallet.',
    });
  }

  diagnostics.push({
    hypothesis: 'Ultra order transaction',
    status: input.order ? 'watch' : 'unknown',
    detail: input.order
      ? 'Jupiter Ultra must return a non-empty transaction. Empty transactions usually mean insufficient funds, no route, or unsupported input.'
      : 'Ultra route checks require a selected order.',
  });

  diagnostics.push({
    hypothesis: 'Privy signing',
    status:
      input.status?.serverKey?.configured && serverCanSign
        ? 'watch'
        : input.status?.serverKey?.configured === false
          ? 'risk'
          : 'unknown',
    detail:
      input.status?.serverKey?.configured && serverCanSign
        ? 'Server authorization key is present; signing can still fail if the key does not match the delegated policy.'
        : input.status?.serverKey?.configured === false
          ? 'Add PRIVY_WALLET_AUTHORIZATION_PRIVATE_KEY before testing delegated signing.'
          : 'Signing readiness depends on server key and delegated policy resolution.',
  });

  diagnostics.push({
    hypothesis: 'Order settlement',
    status: input.order?.status === 'OPEN' ? 'watch' : 'unknown',
    detail:
      input.order?.status === 'OPEN'
        ? 'Database settlement can still fail if the order was claimed, filled, or cancelled concurrently.'
        : 'Settlement check needs an open order.',
  });

  return {
    ok: true,
    canAttempt: blockers.length === 0,
    blockers: Array.from(new Set(blockers)),
    expectedInput,
    wallet: {
      connected: input.connected,
      address: input.walletAddress,
      clientDelegated,
      serverDelegated,
      privyWalletId: input.status?.wallet?.privyWalletId ?? null,
    },
    order: input.order
      ? {
          id: input.order.id,
          kind: input.order.kind,
          ticker: input.order.ticker,
          status: input.order.status,
          side: input.order.side,
        }
      : null,
    diagnostics,
  };
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function detailRecord(detail: unknown): Record<string, unknown> {
  return detail && typeof detail === 'object' ? (detail as Record<string, unknown>) : {};
}

export function diagnosticsForDelegatedUltraApiError(input: {
  message: string;
  status?: number;
  detail?: unknown;
}): DelegatedUltraDiagnostic[] {
  const detail = detailRecord(input.detail);
  const message = input.message;
  const cause = readString(detail, 'cause');
  const requestedRaw = readString(detail, 'requestedRaw');
  const walletRaw = readString(detail, 'walletRaw');
  const inputMint = readString(detail, 'inputMint');

  if (message === 'missing_privy_authorization_private_key') {
    return [
      {
        hypothesis: 'Server authorization key',
        status: 'risk',
        detail: 'Set PRIVY_WALLET_AUTHORIZATION_PRIVATE_KEY in .env and restart the web server.',
      },
    ];
  }

  if (message === 'missing_privy_server_credentials') {
    return [
      {
        hypothesis: 'Privy server credentials',
        status: 'risk',
        detail:
          'PRIVY_APP_ID/NEXT_PUBLIC_PRIVY_APP_ID and PRIVY_APP_SECRET must be available to the server.',
      },
    ];
  }

  if (message === 'missing_privy_authorization_signer_id') {
    return [
      {
        hypothesis: 'Privy authorization signer',
        status: 'risk',
        detail:
          'Set NEXT_PUBLIC_PRIVY_WALLET_AUTHORIZATION_SIGNER_ID to the Privy key quorum ID and restart the web server.',
      },
    ];
  }

  if (message === 'wallet_missing_authorization_signer') {
    return [
      {
        hypothesis: 'Privy authorization signer',
        status: 'risk',
        detail:
          'Enable delegated access again so the wallet adds the configured authorization signer.',
      },
    ];
  }

  if (message === 'wallet_not_delegated' || message === 'privy_wallet_not_delegated') {
    return [
      {
        hypothesis: 'Privy delegation',
        status: 'risk',
        detail:
          'Enable delegated access for the embedded Solana wallet, then run Check before executing.',
      },
    ];
  }

  if (message === 'privy_wallet_not_solana') {
    return [
      {
        hypothesis: 'Privy wallet lookup',
        status: 'risk',
        detail:
          'Privy resolved a wallet, but it is not a Solana wallet. Confirm the linked embedded Solana account.',
      },
    ];
  }

  if (message === 'sell_trigger_missing_token_amount') {
    return [
      {
        hypothesis: 'Order payload',
        status: 'risk',
        detail:
          'TAKE_PROFIT and STOP_LOSS orders need tokenAmount before the server can quote an Ultra sell.',
      },
    ];
  }

  if (message === 'insufficient_funds') {
    return [
      {
        hypothesis: 'Funding balance',
        status: 'risk',
        detail: `Wallet raw balance ${walletRaw ?? 'unknown'} is below requested ${requestedRaw ?? 'unknown'} for ${inputMint ?? 'the input mint'}. Fund the wallet or choose a smaller order.`,
      },
    ];
  }

  if (message === 'ultra_order_unavailable') {
    return [
      {
        hypothesis: 'Ultra order transaction',
        status: 'risk',
        detail: `Jupiter did not return a signable transaction${cause ? `: ${cause}` : ''}. Check balance, route support, and input amount.`,
      },
    ];
  }

  if (message === 'jupiter_ultra_order_failed') {
    return [
      {
        hypothesis: 'Ultra quote/order request',
        status: 'risk',
        detail: `The server could not fetch a Jupiter Ultra order${cause ? `: ${cause}` : ''}. Check RPC/network reachability, route support, and the requested input amount.`,
      },
    ];
  }

  if (message === 'ultra_transaction_deserialize_failed') {
    return [
      {
        hypothesis: 'Ultra transaction shape',
        status: 'risk',
        detail: `Ultra returned transaction bytes that Solana web3.js could not deserialize${cause ? `: ${cause}` : ''}. Inspect requestId and transactionBytes in Details.`,
      },
    ];
  }

  if (message === 'privy_sign_transaction_failed') {
    return [
      {
        hypothesis: 'Privy signing',
        status: 'risk',
        detail: `Privy could not sign with the server authorization key${cause ? `: ${cause}` : ''}. Confirm the key belongs to this Privy app and wallet delegation policy.`,
      },
    ];
  }

  if (message === 'privy_signed_transaction_invalid') {
    return [
      {
        hypothesis: 'Privy signed transaction',
        status: 'risk',
        detail: `Privy returned a signed transaction that could not be decoded${cause ? `: ${cause}` : ''}. Check the signed byte count and signer list in Details.`,
      },
    ];
  }

  if (message === 'jupiter_ultra_execute_failed') {
    return [
      {
        hypothesis: 'Ultra relay',
        status: 'risk',
        detail: `Jupiter Ultra rejected or did not settle the signed transaction${cause ? `: ${cause}` : ''}. Use the requestId/signature fields in Details for relay debugging.`,
      },
    ];
  }

  if (message === 'order_settlement_failed' || message.startsWith('settle_')) {
    return [
      {
        hypothesis: 'Order settlement',
        status: 'risk',
        detail: `Swap may have broadcast, but database settlement failed${cause ? `: ${cause}` : ''}. Check order state before retrying.`,
      },
    ];
  }

  if (message.startsWith('claim_')) {
    return [
      {
        hypothesis: 'Execution claim lock',
        status: 'risk',
        detail:
          'Order claim failed. The order may already be executing, settled, cancelled, or stale.',
      },
    ];
  }

  if (message.includes('Reached end of buffer unexpectedly')) {
    return [
      {
        hypothesis: 'Ultra empty transaction',
        status: 'risk',
        detail:
          'A transaction deserializer received empty bytes. Inspect the Ultra order response; this usually traces back to an empty transaction field.',
      },
    ];
  }

  if (input.status === 401) {
    return [
      {
        hypothesis: 'Dev-tools auth',
        status: 'risk',
        detail: 'Unlock /dev-tools again; the password session or wallet auth token was rejected.',
      },
    ];
  }

  return [];
}
