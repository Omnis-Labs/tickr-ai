'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import {
  Check,
  Clipboard,
  ExternalLink,
  KeyRound,
  LogOut,
  Play,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  SlidersHorizontal,
  Wand2,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  getAssetById,
  getSignalAssets,
  type Proposal,
  type TriggerHitPayload,
} from '@hunch-it/shared';
import { TopAppBar } from '@/components/shell/top-app-bar';
import { useAuthedFetch } from '@/lib/auth/fetch';
import { QK } from '@/lib/hooks/queries';
import {
  JupiterSwapError,
  useJupiterSwap,
  type JupiterSwapDebug,
} from '@/lib/jupiter/use-jupiter-swap';
import {
  decodeSolanaError as decodeClientSolanaError,
  emitDevDiagnostic,
  getDevDiagnostics,
  subscribeDevDiagnostics,
  type ClientDiagnosticEvent,
  type DiagnosticStatus,
  type LogDiagnostic,
} from '@/lib/dev-tools/client-diagnostics';
import {
  buildDelegatedUltraPreflightReport,
  diagnosticsForDelegatedUltraApiError,
  type DelegatedUltraPreflightReport,
} from '@/lib/dev-tools/privy-delegated-ultra-swap-debug';
import { waitForDelegatedAccessRevocation } from '@/lib/delegated-execution/settings-state';
import { diagnosticsFromSwapDebug } from '@/lib/jupiter/swap-diagnostics';
import { executeTriggerOrder } from '@/lib/orders/trigger-execution';
import { isLiveProposal } from '@/lib/proposals/expiration';
import { useRuntime } from '@/lib/runtime/use-runtime';
import { useProposalsStore } from '@/lib/store/proposals';
import { useWallet } from '@/lib/wallet/use-wallet';

type LogSection = 'auth' | 'proposal' | 'orders' | 'protection' | 'swap';
type LogView = LogSection | 'all';
type LogSeverity = 'info' | 'success' | 'warning' | 'error';

interface LogEntry {
  section: LogSection;
  timestamp: string;
  requestId: string;
  step: string;
  summary: string;
  severity: LogSeverity;
  diagnostics: LogDiagnostic[];
  payload?: unknown;
  response?: unknown;
  latencyMs: number;
  error?: string;
  errorDetail?: unknown;
}

interface DevOrder {
  id: string;
  positionId: string;
  kind: 'BUY_TRIGGER' | 'TAKE_PROFIT' | 'STOP_LOSS' | 'CLOSE_SWAP';
  side: 'BUY' | 'SELL' | string;
  status: string;
  triggerPriceUsd: number | null;
  sizeUsd: number;
  tokenAmount: number | null;
  ticker: string;
  mint: string;
  positionState: string;
  proposalId: string | null;
  createdAt: string;
}

interface DevPosition {
  id: string;
  ticker: string;
  mint: string;
  tokenAmount: number;
  entryPrice: number;
  currentTpPrice: number | null;
  currentSlPrice: number | null;
  state: string;
}

interface DevState {
  proposals: Proposal[];
  orders: DevOrder[];
  positions: DevPosition[];
}

interface SessionState {
  enabled: boolean;
  authenticated: boolean;
}

interface DelegatedUltraStatus {
  ok: true;
  serverKey: {
    configured: boolean;
    env: string;
  };
  serverSigner: {
    configured: boolean;
    env: string[];
    walletMatched: boolean;
  };
  wallet: {
    address: string;
    privyWalletId: string | null;
    delegated: boolean | null;
    walletClientType: string | null;
    connectorType: string | null;
    additionalSignerIds: string[];
    ownerId: string | null;
    policyIds: string[];
    authorizationThreshold: number | null;
    resolveError: string | null;
  };
  ready: {
    canExecute: boolean;
    blockers: string[];
  };
}

interface DelegatedUltraResponse {
  ok: true;
  authorizationUsed: {
    serverKey: boolean;
    serverKeyConfigured: boolean;
  };
  wallet: {
    address: string;
    privyWalletId: string;
    delegated: boolean | null;
    ownerId: string | null;
    policyIds: string[];
    authorizationThreshold: number | null;
  };
  trigger: TriggerHitPayload;
  plan: {
    inputMint: string;
    outputMint: string;
    amount: string;
    side: 'BUY' | 'SELL';
    decimals: number;
  };
  balance: {
    inputMint: string;
    requestedRaw: string;
    submittedRaw: string;
    walletRaw: string;
    tokenProgramIds: string[];
  };
  ultraOrder: {
    requestId: string;
    inAmount: string;
    outAmount: string;
    priceImpactPct: string;
    otherAmountThreshold: string;
    transactionBytes: number;
    gasless: boolean | null;
    router: string | null;
    transactionShape: {
      requiredSignatures: number;
      zeroSignatureCount: number;
      signerKeys: string[];
    };
  };
  signedTransaction?: {
    bytes: number;
    transactionShape: {
      zeroSignatureCount: number;
      signerKeys: string[];
    };
  };
  execution?: {
    status: 'Success' | 'Failed';
    signature: string | null;
    error: string | null;
    executionPrice: number;
    tokenAmount: number;
    usdValue: number;
    settlement: unknown;
  };
}

const emptyLogs: Record<LogSection, LogEntry[]> = {
  auth: [],
  proposal: [],
  orders: [],
  protection: [],
  swap: [],
};

const LOG_SECTIONS: LogSection[] = ['auth', 'proposal', 'orders', 'protection', 'swap'];
const DEV_TOOL_ASSETS = getSignalAssets();

const LOG_LABELS: Record<LogSection, string> = {
  auth: 'Auth',
  proposal: 'Proposal',
  orders: 'Orders',
  protection: 'Protection',
  swap: 'Swap',
};

const MAX_LOG_ENTRIES_PER_SECTION = 20;
const MAX_LOG_STRING_CHARS = 420;
const MAX_LOG_ARRAY_ITEMS = 5;
const MAX_LOG_OBJECT_KEYS = 28;
const MAX_LOG_DEPTH = 4;
const MAX_COPY_CHARS = 32_000;
const DELEGATED_ACCESS_TIMEOUT_MS = 45_000;
const STALE_SIGNER_ENV_ERROR = 'stale_privy_authorization_signer_client_env';

function requestId(): string {
  return Math.random().toString(36).slice(2, 9);
}

function timeoutError(message: string, detail: unknown): Error {
  const err = new Error(message) as Error & { detail?: unknown; status?: number };
  err.name = 'DevToolsTimeoutError';
  err.status = 408;
  err.detail = detail;
  return err;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, makeError: () => Error): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(makeError()), ms);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function fmtUsd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '-';
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function stringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? `${v.toString()}n` : v), 2);
}

function truncateText(value: string, max = MAX_LOG_STRING_CHARS): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}... [truncated ${value.length - max} chars]`;
}

function redactLongField(key: string, value: string): string {
  if (!/(^|\.)(transaction|signedTransaction|serializedTransaction|rawTransaction)$/i.test(key)) {
    return truncateText(value);
  }
  if (value.length <= 24) return value;
  return `[redacted ${value.length} chars, ${value.slice(0, 8)}...${value.slice(-8)}]`;
}

function sanitizeForLog(value: unknown, key = 'value', depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return redactLongField(key, value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (value instanceof Error) return compactErrorObject(value);
  if (Array.isArray(value)) {
    const sample = value
      .slice(0, MAX_LOG_ARRAY_ITEMS)
      .map((item, index) => sanitizeForLog(item, `${key}[${index}]`, depth + 1));
    if (value.length <= MAX_LOG_ARRAY_ITEMS) return sample;
    return { count: value.length, sample, truncated: value.length - MAX_LOG_ARRAY_ITEMS };
  }
  if (typeof value === 'object') {
    if (depth >= MAX_LOG_DEPTH) return '[object depth truncated]';
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    const out: Record<string, unknown> = {};
    for (const childKey of keys.slice(0, MAX_LOG_OBJECT_KEYS)) {
      out[childKey] = sanitizeForLog(record[childKey], childKey, depth + 1);
    }
    if (keys.length > MAX_LOG_OBJECT_KEYS) {
      out.__truncatedKeys = keys.length - MAX_LOG_OBJECT_KEYS;
    }
    return out;
  }
  return String(value);
}

interface DecodedSolanaError {
  code: number | null;
  classifier: string;
  context: Record<string, string>;
}

function decodeSolanaError(message: string): DecodedSolanaError | null {
  const decoded = decodeClientSolanaError(message);
  if (decoded) return decoded;
  const codeMatch = message.match(/Solana error #(-?\d+)/);
  const commandMatch = message.match(/decode --\s+-?\d+\s+'([^']+)'/);
  const code = codeMatch ? Number(codeMatch[1]) : null;
  if (code == null && !commandMatch) return null;

  const context: Record<string, string> = {};
  if (commandMatch?.[1] && typeof globalThis.atob === 'function') {
    try {
      const params = new URLSearchParams(globalThis.atob(commandMatch[1]));
      for (const [key, value] of params.entries()) context[key] = value;
    } catch {
      context.__decode = 'failed';
    }
  }

  const noProgramLogs = context.logs === '[]';
  const noCompute = context.unitsConsumed === '0n' || context.unitsConsumed === '0';
  const classifier =
    code === -32002 && noProgramLogs && noCompute
      ? 'pre-execution simulation/precheck failure'
      : code === -32002
        ? 'transaction simulation failed'
        : 'solana rpc error';

  return { code, classifier, context };
}

function compactErrorObject(err: unknown): unknown {
  if (err instanceof Error) {
    const decodedSolanaError = decodeSolanaError(err.message);
    return {
      name: err.name,
      message: truncateText(err.message, 900),
      decodedSolanaError,
    };
  }
  return sanitizeForLog(err);
}

function logErrorDetail(err: unknown): unknown {
  if (err instanceof JupiterSwapError) {
    const decodedSolanaError = decodeSolanaError(`${err.message}\n${err.debug.originalMessage}`);
    return {
      name: err.name,
      message: truncateText(err.message, 900),
      decodedSolanaError,
      swap: err.debug,
      originalError: compactErrorObject(err.originalError),
    };
  }
  if (err instanceof Error) {
    const record = err as Error & { detail?: unknown; status?: number };
    return {
      name: err.name,
      message: truncateText(err.message, 900),
      status: record.status,
      detail: sanitizeForLog(record.detail),
      decodedSolanaError: decodeSolanaError(err.message),
    };
  }
  return { message: String(err) };
}

function summarizeDevState(value: unknown): unknown {
  const state = value as Partial<DevState> | null;
  if (!state || typeof state !== 'object') return sanitizeForLog(value);
  const proposals = state.proposals ?? [];
  const orders = state.orders ?? [];
  const positions = state.positions ?? [];
  return {
    proposals: {
      count: proposals.length,
      live: proposals.filter((p) => isLiveProposal(p)).length,
      tickers: proposals.slice(0, 5).map((p) => p.ticker),
    },
    orders: {
      count: orders.length,
      open: orders.filter((o) => o.status === 'OPEN').length,
      sample: orders.slice(0, 5).map((o) => ({
        id: o.id,
        kind: o.kind,
        ticker: o.ticker,
        status: o.status,
      })),
    },
    positions: {
      count: positions.length,
      active: positions.filter((p) => p.state === 'ACTIVE').length,
      sample: positions.slice(0, 5).map((p) => ({
        id: p.id,
        ticker: p.ticker,
        state: p.state,
        tokenAmount: p.tokenAmount,
      })),
    },
  };
}

function compactResponseForStep(step: string, response: unknown): unknown {
  if (step === 'state.refresh') return summarizeDevState(response);
  return sanitizeForLog(response);
}

function isSwapDebugLike(value: unknown): value is JupiterSwapDebug {
  return !!value && typeof value === 'object' && 'phase' in value && 'orderAgeBucket' in value;
}

function readPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function swapDebugFrom(value: unknown): JupiterSwapDebug | null {
  if (isSwapDebugLike(value)) return value;
  const direct = readPath(value, ['diagnostics']);
  if (isSwapDebugLike(direct)) return direct;
  const errorSwap = readPath(value, ['swap']);
  if (isSwapDebugLike(errorSwap)) return errorSwap;
  return null;
}

function decodedSolanaErrorFrom(value: unknown): DecodedSolanaError | null {
  const direct = readPath(value, ['decodedSolanaError']);
  if (direct && typeof direct === 'object' && 'classifier' in direct) {
    return direct as DecodedSolanaError;
  }
  const original = readPath(value, ['originalError', 'decodedSolanaError']);
  if (original && typeof original === 'object' && 'classifier' in original) {
    return original as DecodedSolanaError;
  }
  return null;
}

function isLogDiagnosticArray(value: unknown): value is LogDiagnostic[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item &&
        typeof item === 'object' &&
        typeof (item as LogDiagnostic).hypothesis === 'string' &&
        typeof (item as LogDiagnostic).status === 'string' &&
        typeof (item as LogDiagnostic).detail === 'string',
    )
  );
}

function embeddedDiagnosticsFrom(value: unknown): LogDiagnostic[] | null {
  const direct = readPath(value, ['diagnostics']);
  if (isLogDiagnosticArray(direct)) return direct;
  const detail = readPath(value, ['detail', 'diagnostics']);
  if (isLogDiagnosticArray(detail)) return detail;
  return null;
}

function buildDiagnostics(step: string, response: unknown, errorDetail?: unknown): LogDiagnostic[] {
  const source = errorDetail ?? response;
  const embeddedDiagnostics = embeddedDiagnosticsFrom(source);
  if (embeddedDiagnostics) return embeddedDiagnostics;
  const debug = swapDebugFrom(source);
  const decoded = decodedSolanaErrorFrom(source);
  if (debug) return diagnosticsFromSwapDebug(debug, decoded);
  if (decoded) {
    return [
      {
        hypothesis: 'Solana RPC error',
        status: decoded.code === -32002 ? 'risk' : 'watch',
        detail: `${decoded.classifier}; logs=${decoded.context.logs ?? 'n/a'}, units=${decoded.context.unitsConsumed ?? 'n/a'}.`,
      },
    ];
  }
  if (step.startsWith('privyDelegatedUltraSwap.')) {
    const apiDiagnostics = diagnosticsForDelegatedUltraApiError({
      message: String(readPath(source, ['message']) ?? ''),
      status:
        typeof readPath(source, ['status']) === 'number'
          ? (readPath(source, ['status']) as number)
          : undefined,
      detail: readPath(source, ['detail']),
    });
    if (apiDiagnostics.length > 0) return apiDiagnostics;

    const delegated = readPath(source, ['wallet', 'delegated']);
    const serverKeyConfigured = readPath(source, ['authorizationUsed', 'serverKeyConfigured']);
    const executeStatus = readPath(source, ['execution', 'status']);
    return [
      {
        hypothesis: 'Privy wallet delegation',
        status: delegated === true ? 'healthy' : delegated === false ? 'risk' : 'watch',
        detail:
          delegated === true
            ? 'Linked embedded Solana wallet reports delegated access.'
            : delegated === false
              ? 'Linked embedded Solana wallet is not delegated yet.'
              : 'Delegation state was not returned for the linked wallet.',
      },
      {
        hypothesis: 'Automation signer',
        status: serverKeyConfigured === true ? 'healthy' : 'watch',
        detail:
          serverKeyConfigured === true
            ? 'A Privy server authorization key env var is configured.'
            : 'A Privy server authorization key is required before delegated swaps can execute.',
      },
      {
        hypothesis: 'Ultra relay',
        status:
          executeStatus === 'Success' ? 'healthy' : step.endsWith('.execute') ? 'watch' : 'unknown',
        detail:
          executeStatus === 'Success'
            ? 'Jupiter Ultra accepted the signed transaction and returned a signature.'
            : step.endsWith('.execute')
              ? 'No successful Ultra execution was recorded.'
              : 'Delegated swap did not reach a successful Ultra execution.',
      },
    ];
  }
  if (step.startsWith('delegatedAccess.')) {
    const serverDelegated = readPath(source, ['wallet', 'delegated']);
    const serverKeyConfigured = readPath(source, ['serverKey', 'configured']);
    const signerConfigured = readPath(source, ['serverSigner', 'configured']);
    const signerMatched = readPath(source, ['serverSigner', 'walletMatched']);
    const walletClientType = readPath(source, ['wallet', 'walletClientType']);
    const blockers = readPath(source, ['ready', 'blockers']);
    const timeoutCode = readPath(source, ['detail', 'code']);
    if (timeoutCode === 'delegated_access_timeout') {
      return [
        {
          hypothesis: 'Privy consent flow',
          status: 'risk',
          detail:
            'Privy did not resolve or reject the delegated-access prompt before the local timeout.',
        },
        {
          hypothesis: 'Wallet delegation',
          status: 'watch',
          detail:
            'Refresh status after approving any Privy modal; if it remains off, retry delegation.',
        },
      ];
    }
    const staleClientEnvCode = readPath(source, ['detail', 'code']);
    if (staleClientEnvCode === STALE_SIGNER_ENV_ERROR) {
      return [
        {
          hypothesis: 'Client env bundle',
          status: 'risk',
          detail:
            'The server can read the signer ID, but the browser bundle cannot. Restart the Next dev server.',
        },
        {
          hypothesis: 'Privy authorization signer',
          status: 'watch',
          detail:
            'After restart, Enable should attach the Privy wallet v2 signer from the browser bundle.',
        },
      ];
    }
    return [
      {
        hypothesis: 'Wallet signer access',
        status: signerMatched === true ? 'healthy' : serverDelegated === true ? 'watch' : 'risk',
        detail:
          signerMatched === true
            ? 'Server can resolve the configured wallet v2 authorization signer for this embedded Solana wallet.'
            : serverDelegated === true
              ? 'Legacy delegated wallet metadata is present, but Auto-execute now requires the wallet v2 signer.'
              : 'The wallet v2 authorization signer is not attached yet.',
      },
      {
        hypothesis: 'Server authorization key',
        status: serverKeyConfigured === true ? 'healthy' : 'risk',
        detail:
          serverKeyConfigured === true
            ? 'The server authorization private key is configured.'
            : 'Add PRIVY_WALLET_AUTHORIZATION_PRIVATE_KEY before executing delegated swaps.',
      },
      {
        hypothesis: 'Privy authorization signer',
        status:
          signerMatched === true
            ? 'healthy'
            : walletClientType === 'privy-v2' && signerConfigured !== true
              ? 'risk'
              : signerConfigured === true
                ? 'watch'
                : 'unknown',
        detail:
          signerMatched === true
            ? 'Configured signer is attached to this wallet.'
            : walletClientType === 'privy-v2' && signerConfigured !== true
              ? 'Add NEXT_PUBLIC_PRIVY_WALLET_AUTHORIZATION_SIGNER_ID before enabling signer delegation.'
              : signerConfigured === true
                ? 'Signer ID is configured; wallet has not attached it yet.'
                : 'Privy wallet v2 signer configuration is missing.',
      },
      {
        hypothesis: 'Execution readiness',
        status:
          Array.isArray(blockers) && blockers.length === 0
            ? 'healthy'
            : Array.isArray(blockers)
              ? 'watch'
              : 'unknown',
        detail: Array.isArray(blockers)
          ? blockers.length
            ? `Blocked by ${blockers.join(', ')}.`
            : 'Delegated swap execution prerequisites are satisfied.'
          : 'Readiness blockers were not returned.',
      },
    ];
  }
  if (step === 'order.claimExecution') {
    return [
      {
        hypothesis: 'Execution claim lock',
        status: errorDetail ? 'risk' : 'healthy',
        detail: errorDetail
          ? 'Claim did not succeed; order may already be handled or executing.'
          : 'Claim acquired before swap.',
      },
    ];
  }
  if (step === 'order.releaseExecution') {
    return [
      {
        hypothesis: 'Claim cleanup',
        status: errorDetail ? 'risk' : 'healthy',
        detail: errorDetail
          ? 'Release failed after an unbroadcast swap.'
          : 'Claim released because swap did not broadcast.',
      },
    ];
  }
  if (step === 'state.refresh') {
    return [
      {
        hypothesis: 'State visibility',
        status: errorDetail ? 'watch' : 'healthy',
        detail: errorDetail
          ? 'Could not refresh state after action.'
          : 'State snapshot refreshed with compact counts.',
      },
    ];
  }
  return [];
}

function severityFor(error: unknown, diagnostics: LogDiagnostic[], step: string): LogSeverity {
  if (error) return 'error';
  if (diagnostics.some((item) => item.status === 'risk')) return 'warning';
  if (
    /generate|accept|forceTrigger|executeSwap|manualClose|protection|login|logout|delegatedAccess\.enable|delegatedAccess\.revoke|privyDelegatedUltraSwap\.execute/.test(
      step,
    )
  ) {
    return 'success';
  }
  return 'info';
}

function buildSummary(step: string, payload: unknown, response?: unknown, error?: unknown): string {
  if (error) {
    const err = error instanceof Error ? error.message : String(error);
    const detail = logErrorDetail(error);
    const debug = swapDebugFrom(detail);
    const decoded = decodedSolanaErrorFrom(detail);
    if (debug && decoded?.code === -32002) {
      return `${debug.phase} failed before on-chain execution (${decoded.classifier}).`;
    }
    if (debug) return `${debug.phase} failed: ${truncateText(debug.originalMessage || err, 180)}`;
    return truncateText(err, 220);
  }

  const payloadRecord = payload as Record<string, unknown>;
  const responseRecord = response as Record<string, unknown>;
  switch (step) {
    case 'state.refresh': {
      const state = response as DevState;
      return `State: ${(state.orders ?? []).filter((o) => o.status === 'OPEN').length} open orders, ${(state.positions ?? []).filter((p) => p.state === 'ACTIVE').length} active positions, ${(state.proposals ?? []).length} proposals.`;
    }
    case 'session.status':
      return responseRecord?.authenticated
        ? 'Dev-tools session is unlocked.'
        : 'Dev-tools session needs login.';
    case 'session.login':
      return 'Dev-tools session unlocked.';
    case 'session.logout':
      return 'Dev-tools session locked.';
    case 'delegatedAccess.status': {
      const ready = readPath(response, ['ready', 'canExecute']);
      const delegated = readPath(response, ['wallet', 'delegated']);
      return `Delegated access status: delegated=${String(delegated)}, ready=${String(ready)}.`;
    }
    case 'delegatedAccess.enable': {
      const ready = readPath(response, ['ready', 'canExecute']);
      return `Delegated access enabled; ready=${String(ready)}.`;
    }
    case 'delegatedAccess.revoke':
      return 'Delegated access revoked.';
    case 'privyDelegatedUltraSwap.preflight': {
      const canAttempt = readPath(response, ['canAttempt']);
      const blockers = readPath(response, ['blockers']);
      if (Array.isArray(blockers) && blockers.length > 0) {
        return `Delegated Ultra preflight blocked by ${blockers.join(', ')}.`;
      }
      return canAttempt === true
        ? 'Delegated Ultra preflight passed; server-key execution can be attempted.'
        : 'Delegated Ultra preflight needs attention.';
    }
    case 'proposal.generate':
      return `Generated ${String(payloadRecord?.ticker ?? 'ticker')} proposal.`;
    case 'proposal.accept':
      return `Accepted proposal ${shortAddress(String(payloadRecord?.proposalId ?? 'unknown'))}.`;
    case 'order.forceTrigger':
      return `Forced trigger for order ${shortAddress(String(payloadRecord?.orderId ?? 'unknown'))}.`;
    case 'order.claimExecution':
      return `Execution claim acquired for ${shortAddress(String(payloadRecord?.orderId ?? 'unknown'))}.`;
    case 'order.releaseExecution':
      return `Execution claim released for ${shortAddress(String(payloadRecord?.orderId ?? 'unknown'))}.`;
    case 'order.executeSwap': {
      const signature = readPath(response, ['swap', 'signature']);
      const price = responseRecord?.executionPrice;
      return `Swap broadcast ${typeof signature === 'string' ? shortAddress(signature) : 'without signature'}; settled at ${typeof price === 'number' ? fmtUsd(price) : 'unknown price'}.`;
    }
    case 'privyDelegatedUltraSwap.execute': {
      const signature = readPath(response, ['execution', 'signature']);
      const price = readPath(response, ['execution', 'executionPrice']);
      return `Privy delegated Ultra swap settled ${typeof signature === 'string' ? shortAddress(signature) : 'without signature'} at ${typeof price === 'number' ? fmtUsd(price) : 'unknown price'}.`;
    }
    case 'position.protection':
      return `Updated TP/SL for ${shortAddress(String(payloadRecord?.positionId ?? 'unknown'))}.`;
    case 'position.manualClose':
      return `Manual close completed for ${shortAddress(String(payloadRecord?.positionId ?? 'unknown'))}.`;
    default:
      return step;
  }
}

function logToText(entries: LogEntry[]): string {
  const text = entries
    .map((entry) => {
      const diagnostics = entry.diagnostics.length
        ? `\n  hypotheses:\n${entry.diagnostics
            .map((item) => `    - [${item.status}] ${item.hypothesis}: ${item.detail}`)
            .join('\n')}`
        : '';
      const details = stringify({
        payload: entry.payload,
        response: entry.response,
        errorDetail: entry.errorDetail,
      });
      return `[${entry.timestamp}] ${LOG_LABELS[entry.section]} ${entry.step} ${entry.severity} ${entry.latencyMs}ms ${entry.requestId}\n  ${entry.summary}${diagnostics}\n  details: ${details}`;
    })
    .join('\n\n');
  if (text.length <= MAX_COPY_CHARS) return text;
  return `${text.slice(0, MAX_COPY_CHARS)}\n\n[log copy truncated at ${MAX_COPY_CHARS} chars]`;
}

function shortAddress(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function stagedDevProposal(proposals: Proposal[], nowMs = Date.now()): Proposal | null {
  return proposals.find((p) => isLiveProposal(p, nowMs)) ?? null;
}

function triggerPayloadFromDevOrder(order: DevOrder): TriggerHitPayload {
  if (order.triggerPriceUsd == null) {
    throw new Error('Selected order has no trigger price.');
  }
  return {
    orderId: order.id,
    positionId: order.positionId,
    ticker: order.ticker,
    mint: order.mint,
    kind: order.kind,
    side: order.kind === 'BUY_TRIGGER' ? 'BUY' : 'SELL',
    triggerPriceUsd: order.triggerPriceUsd,
    currentPriceUsd: order.triggerPriceUsd,
    sizeUsd: order.sizeUsd,
    tokenAmount: order.tokenAmount,
  };
}

function logEntryFromClientDiagnostic(event: ClientDiagnosticEvent): LogEntry {
  return {
    section: event.section,
    timestamp: event.timestamp,
    requestId: event.id,
    step: event.step,
    summary: event.summary,
    severity: event.severity,
    diagnostics: event.diagnostics,
    payload: event.payload,
    response: event.response,
    latencyMs: event.latencyMs,
    error: event.error,
    errorDetail: event.errorDetail,
  };
}

export function DevToolsClient() {
  const authedFetch = useAuthedFetch();
  const wallet = useWallet();
  const {
    connected,
    delegated: clientDelegated,
    delegateWallet,
    login,
    publicKey,
    refreshWalletUser,
    revokeDelegatedWallets,
  } = wallet;
  const { swap } = useJupiterSwap();
  const runtime = useRuntime();
  const qc = useQueryClient();
  const upsertProposal = useProposalsStore((s) => s.upsertProposal);
  const removeProposal = useProposalsStore((s) => s.removeProposal);

  const [session, setSession] = useState<SessionState | null>(null);
  const [password, setPassword] = useState('');
  const [ticker, setTicker] = useState<string>(DEV_TOOL_ASSETS[0]?.assetId ?? 'AAPLx');
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [devState, setDevState] = useState<DevState>({ proposals: [], orders: [], positions: [] });
  const [selectedOrderId, setSelectedOrderId] = useState<string>('');
  const [selectedPositionId, setSelectedPositionId] = useState<string>('');
  const [tpPrice, setTpPrice] = useState('');
  const [slPrice, setSlPrice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [logs, setLogs] = useState<Record<LogSection, LogEntry[]>>(emptyLogs);
  const [selectedLogView, setSelectedLogView] = useState<LogView>('all');
  const [delegatedOrderId, setDelegatedOrderId] = useState<string>('');
  const [delegatedUltraStatus, setDelegatedUltraStatus] = useState<DelegatedUltraStatus | null>(
    null,
  );
  const [delegatedUltraResult, setDelegatedUltraResult] = useState<DelegatedUltraResponse | null>(
    null,
  );
  const [nowMs, setNowMs] = useState(() => Date.now());

  const walletAddress = publicKey?.toBase58() ?? null;
  const selectedOrder = useMemo(
    () => devState.orders.find((order) => order.id === selectedOrderId) ?? null,
    [devState.orders, selectedOrderId],
  );
  const activePositions = useMemo(
    () => devState.positions.filter((position) => position.state === 'ACTIVE'),
    [devState.positions],
  );
  const selectedPosition = useMemo(
    () => activePositions.find((position) => position.id === selectedPositionId) ?? null,
    [activePositions, selectedPositionId],
  );
  const openOrders = useMemo(
    () => devState.orders.filter((order) => order.status === 'OPEN'),
    [devState.orders],
  );
  const delegatedOpenOrders = useMemo(
    () =>
      openOrders.filter((order) =>
        ['BUY_TRIGGER', 'TAKE_PROFIT', 'STOP_LOSS'].includes(order.kind),
      ),
    [openOrders],
  );
  const selectedDelegatedOrder = useMemo(
    () => delegatedOpenOrders.find((order) => order.id === delegatedOrderId) ?? null,
    [delegatedOpenOrders, delegatedOrderId],
  );
  const delegatedPreflightPreview = useMemo(
    () =>
      buildDelegatedUltraPreflightReport({
        connected,
        walletAddress,
        clientDelegated,
        status: delegatedUltraStatus,
        order: selectedDelegatedOrder,
      }),
    [clientDelegated, connected, delegatedUltraStatus, selectedDelegatedOrder, walletAddress],
  );
  const activeProposal = useMemo(() => {
    if (proposal && isLiveProposal(proposal, nowMs)) return proposal;
    return stagedDevProposal(devState.proposals, nowMs);
  }, [devState.proposals, nowMs, proposal]);

  const appendLog = useCallback((section: LogSection, entry: LogEntry) => {
    setLogs((prev) => ({
      ...prev,
      [section]: [
        entry,
        ...prev[section].filter((item) => item.requestId !== entry.requestId),
      ].slice(0, MAX_LOG_ENTRIES_PER_SECTION),
    }));
  }, []);

  useEffect(() => {
    for (const event of getDevDiagnostics()) {
      appendLog(event.section, logEntryFromClientDiagnostic(event));
    }
    return subscribeDevDiagnostics((event) => {
      appendLog(event.section, logEntryFromClientDiagnostic(event));
    });
  }, [appendLog]);

  const runLogged = useCallback(
    async <T,>(
      section: LogSection,
      step: string,
      payload: unknown,
      fn: () => Promise<T>,
    ): Promise<T> => {
      const id = requestId();
      const start = performance.now();
      try {
        const response = await fn();
        const diagnostics = buildDiagnostics(step, response);
        const entryPayload = sanitizeForLog(payload);
        const entryResponse = compactResponseForStep(step, response);
        const entry: LogEntry = {
          section,
          timestamp: new Date().toISOString(),
          requestId: id,
          step,
          summary: buildSummary(step, payload, response),
          severity: severityFor(null, diagnostics, step),
          diagnostics,
          payload: entryPayload,
          response: entryResponse,
          latencyMs: Math.round(performance.now() - start),
        };
        appendLog(section, entry);
        console.groupCollapsed(`[dev-tools] ${step} ${id}`);
        console.log('summary', entry.summary);
        console.log('payload', entryPayload);
        console.log('response', entryResponse);
        if (diagnostics.length > 0) console.table(diagnostics);
        console.log('latencyMs', entry.latencyMs);
        console.groupEnd();
        return response;
      } catch (err) {
        const errorDetail = logErrorDetail(err);
        const diagnostics = buildDiagnostics(step, undefined, errorDetail);
        const entryPayload = sanitizeForLog(payload);
        const entry: LogEntry = {
          section,
          timestamp: new Date().toISOString(),
          requestId: id,
          step,
          summary: buildSummary(step, payload, undefined, err),
          severity: severityFor(err, diagnostics, step),
          diagnostics,
          payload: entryPayload,
          latencyMs: Math.round(performance.now() - start),
          error: truncateText(err instanceof Error ? err.message : String(err), 900),
          errorDetail,
        };
        appendLog(section, entry);
        console.groupCollapsed(`[dev-tools] ${step} ${id} error`);
        console.log('summary', entry.summary);
        console.log('payload', entryPayload);
        console.log('errorDetail', entry.errorDetail);
        if (diagnostics.length > 0) console.table(diagnostics);
        console.error(err instanceof Error ? err : String(err));
        console.log('latencyMs', entry.latencyMs);
        console.groupEnd();
        throw err;
      }
    },
    [appendLog],
  );

  const fetchSessionStatus = useCallback(async () => {
    const res = await fetch('/api/dev-tools/session', { cache: 'no-store' });
    return (await res.json()) as SessionState;
  }, []);

  const refreshSession = useCallback(
    async ({ log = false }: { log?: boolean } = {}) => {
      const next = log
        ? await runLogged('auth', 'session.status', {}, fetchSessionStatus)
        : await fetchSessionStatus();
      setSession(next);
    },
    [fetchSessionStatus, runLogged],
  );

  const refreshDevState = useCallback(
    async ({ log = true }: { log?: boolean } = {}) => {
      const fetchState = async () => {
        const res = await authedFetch('/api/dev-tools/orders');
        const json = (await res.json().catch(() => ({}))) as DevState & { error?: string };
        if (!res.ok) throw new Error(json.error ?? `${res.status}`);
        return json;
      };
      const next = log
        ? await runLogged('orders', 'state.refresh', {}, fetchState)
        : await fetchState();
      setDevState({
        proposals: next.proposals ?? [],
        orders: next.orders ?? [],
        positions: next.positions ?? [],
      });
      const nowMs = Date.now();
      const proposals = next.proposals ?? [];
      const activeProposal = stagedDevProposal(proposals, nowMs);
      const inactiveProposalIds = new Set(
        proposals.filter((p) => !isLiveProposal(p, nowMs)).map((p) => p.id),
      );
      for (const p of proposals) {
        if (!isLiveProposal(p, nowMs)) removeProposal(p.id);
      }
      if (activeProposal) {
        upsertProposal(activeProposal);
      }
      qc.setQueryData<{ proposals: Proposal[] }>(QK.proposals(), (current) => {
        const existing = current?.proposals ?? [];
        const cachedProposals = existing.filter(
          (p) =>
            p.id !== activeProposal?.id &&
            !inactiveProposalIds.has(p.id) &&
            isLiveProposal(p, nowMs),
        );
        return {
          proposals: activeProposal ? [activeProposal, ...cachedProposals] : cachedProposals,
        };
      });
      setProposal((current) => {
        if (!current) return activeProposal;
        const refreshedCurrent = proposals.find((p) => p.id === current.id);
        if (refreshedCurrent && isLiveProposal(refreshedCurrent, nowMs)) return refreshedCurrent;
        return activeProposal;
      });
    },
    [authedFetch, qc, removeProposal, runLogged, upsertProposal],
  );

  const refreshDelegatedStatus = useCallback(
    async ({ log = true }: { log?: boolean } = {}) => {
      const fetchStatus = async () => {
        const res = await authedFetch('/api/dev-tools/privy-delegated-ultra-swap', {
          cache: 'no-store',
        });
        const json = (await res.json().catch(() => ({}))) as DelegatedUltraStatus & {
          error?: string;
          detail?: unknown;
        };
        if (!res.ok) {
          const err = new Error(json.error ?? `${res.status}`) as Error & {
            detail?: unknown;
            status?: number;
          };
          err.name = 'DevToolsApiError';
          err.status = res.status;
          err.detail = json.detail;
          throw err;
        }
        return json;
      };
      const next = log
        ? await runLogged('auth', 'delegatedAccess.status', {}, fetchStatus)
        : await fetchStatus();
      setDelegatedUltraStatus(next);
      return next;
    },
    [authedFetch, runLogged],
  );

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 15_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!session?.authenticated || !connected) return;
    void refreshDevState({ log: false }).catch(() => {});
  }, [session?.authenticated, connected, refreshDevState]);

  useEffect(() => {
    if (!session?.authenticated || !connected) return;
    void refreshDelegatedStatus({ log: false }).catch(() => {});
  }, [session?.authenticated, connected, refreshDelegatedStatus]);

  useEffect(() => {
    if (!proposal || isLiveProposal(proposal, nowMs)) return;
    removeProposal(proposal.id);
    setProposal(null);
    void qc.invalidateQueries({ queryKey: QK.proposals() });
    if (session?.authenticated && connected) void refreshDevState({ log: false }).catch(() => {});
  }, [connected, nowMs, proposal, qc, refreshDevState, removeProposal, session?.authenticated]);

  useEffect(() => {
    if (!selectedOrderId && openOrders[0]) setSelectedOrderId(openOrders[0].id);
  }, [openOrders, selectedOrderId]);

  useEffect(() => {
    if (delegatedOrderId && delegatedOpenOrders.some((order) => order.id === delegatedOrderId)) {
      return;
    }
    const preferred =
      delegatedOpenOrders.find((order) => order.kind === 'BUY_TRIGGER') ?? delegatedOpenOrders[0];
    setDelegatedOrderId(preferred?.id ?? '');
  }, [delegatedOpenOrders, delegatedOrderId]);

  useEffect(() => {
    if (!selectedPositionId && activePositions[0]) setSelectedPositionId(activePositions[0].id);
  }, [activePositions, selectedPositionId]);

  useEffect(() => {
    if (!selectedPosition) return;
    setTpPrice(selectedPosition.currentTpPrice?.toString() ?? '');
    setSlPrice(selectedPosition.currentSlPrice?.toString() ?? '');
  }, [selectedPosition]);

  async function loginDevTools() {
    setBusy('auth');
    try {
      await runLogged('auth', 'session.login', { password: '[redacted]' }, async () => {
        const res = await fetch('/api/dev-tools/session', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ password }),
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(json.error ?? `${res.status}`);
        return json;
      });
      setPassword('');
      await refreshSession({ log: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function logoutDevTools() {
    await runLogged('auth', 'session.logout', {}, async () => {
      const res = await fetch('/api/dev-tools/session', { method: 'DELETE' });
      return res.json();
    });
    setSession({ enabled: true, authenticated: false });
  }

  async function generateProposal() {
    if (activeProposal) {
      toast.error('Skip the active proposal or wait for it to expire before generating another.');
      return;
    }
    setBusy('generate');
    try {
      const result = await runLogged('proposal', 'proposal.generate', { ticker }, async () => {
        const res = await authedFetch('/api/dev-tools/proposals', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ticker }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          proposal?: Proposal;
          error?: string;
        };
        if (!res.ok) {
          if (res.status === 409 && json.error === 'active_dev_tools_proposal_exists') {
            throw new Error('Active dev-tools proposal already exists.');
          }
          throw new Error(json.error ?? `${res.status}`);
        }
        return json;
      });
      const createdProposal = result.proposal;
      if (createdProposal) {
        setProposal(createdProposal);
        upsertProposal(createdProposal);
        qc.setQueryData<{ proposals: Proposal[] }>(QK.proposals(), (current) => {
          const existing = current?.proposals ?? [];
          const nowMs = Date.now();
          return {
            proposals: [
              createdProposal,
              ...existing.filter((p) => p.id !== createdProposal.id && isLiveProposal(p, nowMs)),
            ],
          };
        });
      }
      toast.success('Proposal created.');
      await refreshDevState();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function acceptProposal() {
    const proposalToAccept = activeProposal;
    if (!proposalToAccept) return;
    const walletAddress = publicKey?.toBase58();
    if (!walletAddress) {
      toast.error('Connect a wallet first.');
      return;
    }
    const meta = getAssetById(proposalToAccept.ticker);
    if (!meta?.mint) {
      toast.error(`${proposalToAccept.ticker} mint not configured.`);
      return;
    }
    setBusy('accept');
    try {
      const result = await runLogged(
        'proposal',
        'proposal.accept',
        { proposalId: proposalToAccept.id },
        async () => {
          const res = await authedFetch('/api/orders', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              walletAddress,
              proposalId: proposalToAccept.id,
              ticker: proposalToAccept.ticker,
              kind: 'BUY_TRIGGER',
              side: 'BUY',
              triggerPriceUsd: proposalToAccept.suggestedTriggerPrice,
              sizeUsd: proposalToAccept.suggestedSizeUsd,
              txSignature: null,
              slippageBps: 50,
              createPosition: {
                mint: meta.mint,
                entryPriceEstimate: proposalToAccept.suggestedTriggerPrice,
                tpPrice: proposalToAccept.suggestedTakeProfitPrice,
                slPrice: proposalToAccept.suggestedStopLossPrice,
              },
            }),
          });
          const json = (await res.json().catch(() => ({}))) as {
            order?: { id?: string };
            positionId?: string;
            error?: string;
          };
          if (!res.ok) throw new Error(json.error ?? `${res.status}`);
          return json;
        },
      );
      if (result.order?.id) setSelectedOrderId(result.order.id);
      removeProposal(proposalToAccept.id);
      setProposal(null);
      toast.success('Order and position created.');
      await refreshDevState();
      void qc.invalidateQueries({ queryKey: QK.proposals() });
      void qc.invalidateQueries({ queryKey: QK.orders() });
      void qc.invalidateQueries({ queryKey: QK.positions() });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function forceTrigger(orderId = selectedOrderId) {
    if (!orderId) return;
    setBusy(`force:${orderId}`);
    try {
      await runLogged('orders', 'order.forceTrigger', { orderId }, async () => {
        const res = await authedFetch(`/api/dev-tools/orders/${orderId}/force-trigger`, {
          method: 'POST',
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(json.error ?? `${res.status}`);
        return json;
      });
      toast.success('Trigger emitted.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function executeOrder() {
    if (!selectedOrder) return;
    const meta = getAssetById(selectedOrder.ticker);
    if (!meta?.mint) {
      toast.error(`${selectedOrder.ticker} mint not configured.`);
      return;
    }
    setBusy('execute');
    try {
      const payload = triggerPayloadFromDevOrder(selectedOrder);
      const outcome = await runLogged(
        'swap',
        'order.executeViaTriggerRuntime',
        { orderId: selectedOrder.id, kind: selectedOrder.kind },
        async () => {
          const result = await executeTriggerOrder(
            {
              payload,
              mint: meta.mint,
              decimals: meta.decimals,
            },
            {
              authedFetch,
              swap,
              emitDiagnostic: emitDevDiagnostic,
            },
          );
          if (result.kind === 'preBroadcastFailed') {
            throw new Error(`${result.message} (claim released=${result.released})`);
          }
          if (result.kind === 'broadcastButSettleFailed' || result.kind === 'failed') {
            throw new Error(result.message);
          }
          return result;
        },
      );

      if (outcome.kind === 'alreadyHandled') {
        toast.success('Order already settled.');
      } else if (outcome.kind === 'alreadyExecuting') {
        toast('Order is already executing.');
      } else {
        toast.success('Swap settled.');
      }
      await refreshDevState();
      void qc.invalidateQueries({ queryKey: QK.orders() });
      void qc.invalidateQueries({ queryKey: QK.positions() });
      void qc.invalidateQueries({ queryKey: QK.portfolio() });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      await refreshDevState().catch(() => {});
    } finally {
      setBusy(null);
    }
  }

  async function enableDelegatedAccess() {
    if (!connected) {
      login();
      return;
    }
    setBusy('delegated-access:enable');
    try {
      const payload = {
        walletAddress,
        walletClientType: wallet.walletClientType,
        connectorType: wallet.connectorType,
        privyWalletId: wallet.privyWalletId,
        delegationMode: wallet.delegationMode,
        authorizationSignerIdConfigured: wallet.authorizationSignerIdConfigured,
        clientDelegated,
      };
      const status = await runLogged('auth', 'delegatedAccess.enable', payload, async () => {
        const preflight = await refreshDelegatedStatus({ log: false }).catch(() => null);
        if (preflight?.serverSigner.configured && !wallet.authorizationSignerIdConfigured) {
          throw timeoutError('Restart the web dev server to expose the Privy signer ID.', {
            code: STALE_SIGNER_ENV_ERROR,
            serverSigner: preflight.serverSigner,
            wallet: payload,
          });
        }
        await withTimeout(delegateWallet(), DELEGATED_ACCESS_TIMEOUT_MS, () =>
          timeoutError('Privy delegated-access prompt did not complete.', {
            code: 'delegated_access_timeout',
            timeoutMs: DELEGATED_ACCESS_TIMEOUT_MS,
            wallet: payload,
          }),
        );
        await refreshWalletUser().catch(() => {});
        return refreshDelegatedStatus({ log: false });
      });
      setDelegatedUltraStatus(status);
      toast.success('Delegated access enabled.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      await refreshDelegatedStatus({ log: false }).catch(() => {});
    } finally {
      setBusy(null);
    }
  }

  async function revokeDelegatedAccess() {
    setBusy('delegated-access:revoke');
    try {
      const status = await runLogged(
        'auth',
        'delegatedAccess.revoke',
        {
          walletAddress,
          walletClientType: wallet.walletClientType,
          connectorType: wallet.connectorType,
          privyWalletId: wallet.privyWalletId,
          delegationMode: wallet.delegationMode,
          authorizationSignerIdConfigured: wallet.authorizationSignerIdConfigured,
          clientDelegated,
        },
        async () => {
          const status = await waitForDelegatedAccessRevocation({
            revoke: revokeDelegatedWallets,
            readStatus: () => refreshDelegatedStatus({ log: false }),
          });
          void refreshWalletUser().catch(() => {});
          return status;
        },
      );
      setDelegatedUltraStatus(status);
      setDelegatedUltraResult(null);
      toast.success('Delegated access revoked.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      await refreshDelegatedStatus({ log: false }).catch(() => {});
    } finally {
      setBusy(null);
    }
  }

  async function checkDelegatedAccess() {
    setBusy('delegated-access:status');
    try {
      await refreshDelegatedStatus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function runDelegatedUltraSwap() {
    if (!selectedDelegatedOrder) return;
    setBusy('delegated-swap:execute');
    try {
      await runLogged(
        'swap',
        'privyDelegatedUltraSwap.preflight',
        { orderId: selectedDelegatedOrder.id },
        async () => {
          const status = await refreshDelegatedStatus({ log: false });
          const report = buildDelegatedUltraPreflightReport({
            connected,
            walletAddress,
            clientDelegated,
            status,
            order: selectedDelegatedOrder,
          });
          if (!report.canAttempt) {
            const err = new Error(
              `Delegated Ultra preflight blocked: ${report.blockers.join(', ')}`,
            ) as Error & {
              detail?: unknown;
              status?: number;
            };
            err.name = 'DevToolsPreflightError';
            err.status = 400;
            err.detail = report;
            throw err;
          }
          return report;
        },
      );
      const result = await runLogged(
        'swap',
        'privyDelegatedUltraSwap.execute',
        {
          orderId: selectedDelegatedOrder.id,
        },
        async () => {
          const res = await authedFetch('/api/dev-tools/privy-delegated-ultra-swap', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              orderId: selectedDelegatedOrder.id,
            }),
          });
          const json = (await res.json().catch(() => ({}))) as
            | DelegatedUltraResponse
            | { error?: string; detail?: unknown };
          if (!res.ok) {
            const err = new Error(
              'error' in json && json.error ? json.error : `${res.status}`,
            ) as Error & {
              detail?: unknown;
              status?: number;
            };
            err.name = 'DevToolsApiError';
            err.status = res.status;
            err.detail = 'detail' in json ? json.detail : undefined;
            throw err;
          }
          return json as DelegatedUltraResponse;
        },
      );
      setDelegatedUltraResult(result);
      toast.success('Delegated Ultra swap settled.');
      await refreshDevState();
      await refreshDelegatedStatus({ log: false }).catch(() => {});
      void qc.invalidateQueries({ queryKey: QK.orders() });
      void qc.invalidateQueries({ queryKey: QK.positions() });
      void qc.invalidateQueries({ queryKey: QK.portfolio() });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      await refreshDevState().catch(() => {});
      await refreshDelegatedStatus({ log: false }).catch(() => {});
    } finally {
      setBusy(null);
    }
  }

  async function adjustProtection() {
    if (!selectedPosition) return;
    const body = {
      ...(tpPrice ? { tpPrice: Number(tpPrice) } : {}),
      ...(slPrice ? { slPrice: Number(slPrice) } : {}),
    };
    setBusy('protection');
    try {
      await runLogged(
        'protection',
        'position.protection',
        { positionId: selectedPosition.id, ...body },
        async () => {
          const res = await authedFetch(`/api/positions/${selectedPosition.id}/protection`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          });
          const json = (await res.json().catch(() => ({}))) as { error?: string };
          if (!res.ok) throw new Error(json.error ?? `${res.status}`);
          return json;
        },
      );
      toast.success('Protection updated.');
      await refreshDevState();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function closePosition() {
    if (!selectedPosition) return;
    const meta = getAssetById(selectedPosition.ticker);
    if (!meta?.mint) {
      toast.error(`${selectedPosition.ticker} mint not configured.`);
      return;
    }
    setBusy('close');
    try {
      await runLogged(
        'swap',
        'position.manualClose',
        { positionId: selectedPosition.id },
        async () => {
          return runtime.closePosition({
            positionId: selectedPosition.id,
            meta: { mint: meta.mint, decimals: meta.decimals },
            fallbackMarkPrice: selectedPosition.entryPrice,
            tokenAmount: selectedPosition.tokenAmount,
          });
        },
      );
      toast.success('Position closed.');
      await refreshDevState();
      void qc.invalidateQueries({ queryKey: QK.positions() });
      void qc.invalidateQueries({ queryKey: QK.portfolio() });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const allLogs = useMemo(
    () =>
      Object.values(logs)
        .flat()
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
    [logs],
  );
  const triggerSwapLogs = useMemo(
    () => logs.swap.filter((entry) => entry.step.startsWith('trigger.')),
    [logs.swap],
  );
  const delegatedUltraLogs = useMemo(
    () => logs.swap.filter((entry) => entry.step.startsWith('privyDelegatedUltraSwap.')),
    [logs.swap],
  );
  const delegatedAccessLogs = useMemo(
    () => logs.auth.filter((entry) => entry.step.startsWith('delegatedAccess.')),
    [logs.auth],
  );

  if (session && !session.enabled) {
    return (
      <>
        <TopAppBar title="Dev tools" />
        <main className="mx-auto max-w-3xl px-5 py-8">
          <section className="rounded-lg bg-surface p-5 shadow-soft">
            <h1 className="text-title-lg text-primary">Unavailable</h1>
            <p className="mt-2 text-body-sm text-on-surface-variant">Dev tools are disabled.</p>
          </section>
        </main>
      </>
    );
  }

  if (!session?.authenticated) {
    return (
      <>
        <TopAppBar title="Dev tools" />
        <main className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-md items-center px-5 py-8">
          <section className="w-full rounded-lg bg-surface p-5 shadow-soft">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-accent text-on-accent">
              <KeyRound aria-hidden className="h-5 w-5" />
            </div>
            <h1 className="text-title-lg text-primary">Password required</h1>
            <div className="mt-5 flex flex-col gap-3">
              <label className="text-label-sm text-on-surface-variant" htmlFor="dev-password">
                Password
              </label>
              <input
                id="dev-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void loginDevTools();
                }}
                className="h-12 rounded-full bg-surface-container-low px-4 text-body-md text-primary outline-none ring-1 ring-outline-variant focus:ring-2 focus:ring-primary"
              />
              <button
                type="button"
                onClick={() => void loginDevTools()}
                disabled={!password || busy === 'auth'}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-primary px-5 text-label-lg text-on-primary transition-transform active:scale-[0.97] disabled:opacity-50"
              >
                <ShieldCheck aria-hidden className="h-4 w-4" />
                {busy === 'auth' ? 'Checking...' : 'Unlock'}
              </button>
            </div>
          </section>
        </main>
      </>
    );
  }

  return (
    <>
      <TopAppBar
        title="Dev tools"
        rightAction={
          <button
            type="button"
            title="Lock dev tools"
            onClick={() => void logoutDevTools()}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-surface text-primary shadow-micro"
          >
            <LogOut aria-hidden className="h-4 w-4" />
          </button>
        }
      />
      <main className="mx-auto flex max-w-5xl flex-col gap-5 px-5 py-6 pb-24">
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatusPill
            icon={<ShieldCheck className="h-4 w-4" />}
            label="Session"
            value="Unlocked"
            detail="Password cookie active"
          />
          <StatusPill
            icon={<Zap className="h-4 w-4" />}
            label="Wallet"
            value={connected ? 'Connected' : 'Signed out'}
            detail={
              walletAddress ? shortAddress(walletAddress) : 'Connect to create and execute orders'
            }
          />
          <StatusPill
            icon={<Wand2 className="h-4 w-4" />}
            label="Proposals"
            value={activeProposal ? '1' : '0'}
            detail={
              activeProposal ? `${activeProposal.ticker} staged for accept` : 'No staged proposal'
            }
          />
          <StatusPill
            icon={<SlidersHorizontal className="h-4 w-4" />}
            label="Positions"
            value={activePositions.length.toString()}
            detail={`${openOrders.length} open orders`}
          />
        </section>

        {!connected && (
          <section className="rounded-lg bg-tertiary-container p-4 text-on-tertiary-container">
            <button
              type="button"
              onClick={login}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-primary px-5 text-label-lg text-on-primary"
            >
              <KeyRound aria-hidden className="h-4 w-4" />
              Sign in
            </button>
          </section>
        )}

        <section className="grid gap-5 lg:grid-cols-2">
          <Panel title="Proposal lab" icon={<Wand2 className="h-5 w-5" />}>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
              <select
                value={ticker}
                onChange={(event) => setTicker(event.target.value)}
                className="h-12 rounded-full bg-surface-container-low px-4 text-label-lg text-primary outline-none ring-1 ring-outline-variant"
              >
                {DEV_TOOL_ASSETS.map((asset) => (
                  <option key={asset.assetId} value={asset.assetId}>
                    {asset.displaySymbol}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void generateProposal()}
                disabled={!connected || busy === 'generate' || Boolean(activeProposal)}
                title={
                  activeProposal
                    ? 'Skip the active proposal or wait for it to expire before generating another.'
                    : undefined
                }
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-accent px-5 text-label-lg text-on-accent transition-transform active:scale-[0.97] disabled:opacity-50"
              >
                <Wand2 aria-hidden className="h-4 w-4" />
                {busy === 'generate' ? 'Generating...' : 'Generate'}
              </button>
              <button
                type="button"
                onClick={() => void acceptProposal()}
                disabled={!activeProposal || !connected || busy === 'accept'}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-primary px-5 text-label-lg text-on-primary transition-transform active:scale-[0.97] disabled:opacity-50"
              >
                <Check aria-hidden className="h-4 w-4" />
                {busy === 'accept' ? 'Accepting...' : 'Accept'}
              </button>
            </div>
            {activeProposal && (
              <div className="mt-4 rounded-md bg-surface-container-low p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-title-md text-primary">{activeProposal.ticker}</p>
                    <p className="text-body-sm text-on-surface-variant">{activeProposal.id}</p>
                  </div>
                  <Link
                    href={`/proposals/${activeProposal.id}`}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-surface px-4 text-label-md text-primary"
                  >
                    <ExternalLink aria-hidden className="h-4 w-4" />
                    Open
                  </Link>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-body-sm">
                  <Metric label="Size" value={fmtUsd(activeProposal.suggestedSizeUsd)} />
                  <Metric label="Trigger" value={fmtUsd(activeProposal.suggestedTriggerPrice)} />
                  <Metric label="TP" value={fmtUsd(activeProposal.suggestedTakeProfitPrice)} />
                  <Metric label="SL" value={fmtUsd(activeProposal.suggestedStopLossPrice)} />
                </dl>
              </div>
            )}
            <LogBlock title="Proposal log" entries={logs.proposal} compact />
          </Panel>

          <Panel title="Orders" icon={<Zap className="h-5 w-5" />}>
            <div className="flex flex-col gap-3">
              <div className="flex gap-2">
                <select
                  value={selectedOrderId}
                  onChange={(event) => setSelectedOrderId(event.target.value)}
                  className="min-w-0 flex-1 rounded-full bg-surface-container-low px-4 text-label-md text-primary outline-none ring-1 ring-outline-variant"
                >
                  <option value="">No order selected</option>
                  {openOrders.map((order) => (
                    <option key={order.id} value={order.id}>
                      {order.kind} {order.ticker} {fmtUsd(order.triggerPriceUsd)}
                    </option>
                  ))}
                </select>
                <IconButton
                  title="Refresh"
                  onClick={() => void refreshDevState()}
                  icon={<RefreshCw className="h-4 w-4" />}
                />
              </div>
              {selectedOrder && (
                <div className="rounded-md bg-surface-container-low p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-title-md text-primary">{selectedOrder.kind}</p>
                      <p className="text-body-sm text-on-surface-variant">{selectedOrder.id}</p>
                    </div>
                    <span className="rounded-full bg-primary px-3 py-1 text-label-sm text-on-primary">
                      {selectedOrder.status}
                    </span>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-body-sm">
                    <Metric label="Ticker" value={selectedOrder.ticker} />
                    <Metric label="Trigger" value={fmtUsd(selectedOrder.triggerPriceUsd)} />
                    <Metric label="Size" value={fmtUsd(selectedOrder.sizeUsd)} />
                    <Metric label="Tokens" value={selectedOrder.tokenAmount?.toFixed(6) ?? '-'} />
                  </dl>
                </div>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => void forceTrigger()}
                  disabled={!selectedOrder || busy?.startsWith('force')}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-accent px-4 text-label-lg text-on-accent transition-transform active:scale-[0.97] disabled:opacity-50"
                >
                  <Zap aria-hidden className="h-4 w-4" />
                  Force trigger
                </button>
                <button
                  type="button"
                  onClick={() => void executeOrder()}
                  disabled={!selectedOrder || busy === 'execute'}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-primary px-4 text-label-lg text-on-primary transition-transform active:scale-[0.97] disabled:opacity-50"
                >
                  <Play aria-hidden className="h-4 w-4" />
                  {busy === 'execute' ? 'Executing...' : 'Execute swap'}
                </button>
              </div>
            </div>
            <LogBlock title="Order log" entries={logs.orders} compact />
            <LogBlock title="Trigger swap log" entries={triggerSwapLogs} compact />
          </Panel>

          <Panel title="Delegated access" icon={<ShieldCheck className="h-5 w-5" />}>
            <div className="flex flex-col gap-3">
              <div className="rounded-md bg-surface-container-low p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-title-md text-primary">
                      {walletAddress ? shortAddress(walletAddress) : 'No wallet'}
                    </p>
                    <p className="text-body-sm text-on-surface-variant">
                      {delegatedUltraStatus?.ready.canExecute
                        ? 'Ready for server-key swaps'
                        : 'Setup required'}
                    </p>
                  </div>
                  <span className="rounded-full bg-surface px-3 py-1 text-label-sm text-primary">
                    {(delegatedUltraStatus?.wallet.delegated ?? clientDelegated)
                      ? 'Delegated'
                      : 'Not delegated'}
                  </span>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-body-sm">
                  <Metric
                    label="Client access"
                    value={
                      clientDelegated == null ? 'Unknown' : clientDelegated ? 'Delegated' : 'Off'
                    }
                  />
                  <Metric
                    label="Server access"
                    value={
                      delegatedUltraStatus?.wallet.delegated == null
                        ? 'Unknown'
                        : delegatedUltraStatus.wallet.delegated
                          ? 'Delegated'
                          : 'Off'
                    }
                  />
                  <Metric
                    label="Server key"
                    value={delegatedUltraStatus?.serverKey.configured ? 'Configured' : 'Missing'}
                  />
                  <Metric
                    label="Signer ID"
                    value={
                      (delegatedUltraStatus?.serverSigner?.configured ??
                      wallet.authorizationSignerIdConfigured)
                        ? 'Configured'
                        : 'Missing'
                    }
                  />
                  <Metric
                    label="Privy wallet"
                    value={
                      delegatedUltraStatus?.wallet.privyWalletId
                        ? shortAddress(delegatedUltraStatus.wallet.privyWalletId)
                        : wallet.privyWalletId
                          ? shortAddress(wallet.privyWalletId)
                          : '-'
                    }
                  />
                  <Metric
                    label="Wallet type"
                    value={
                      delegatedUltraStatus?.wallet.walletClientType ??
                      wallet.walletClientType ??
                      'Unknown'
                    }
                  />
                  <Metric
                    label="Connector"
                    value={
                      delegatedUltraStatus?.wallet.connectorType ??
                      wallet.connectorType ??
                      'Unknown'
                    }
                  />
                  <Metric label="Mode" value={wallet.delegationMode ?? 'Unknown'} />
                </dl>
                {delegatedUltraStatus?.ready.blockers.length ? (
                  <p className="mt-3 text-body-sm text-on-surface-variant">
                    Blocked by {delegatedUltraStatus.ready.blockers.join(', ')}.
                  </p>
                ) : null}
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={() => void checkDelegatedAccess()}
                  disabled={!connected || busy === 'delegated-access:status'}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-surface-container-low px-4 text-label-lg text-primary ring-1 ring-outline-variant transition-transform active:scale-[0.97] disabled:opacity-50"
                >
                  <RefreshCw aria-hidden className="h-4 w-4" />
                  {busy === 'delegated-access:status' ? 'Checking...' : 'Check'}
                </button>
                <button
                  type="button"
                  onClick={() => void enableDelegatedAccess()}
                  disabled={!connected || busy === 'delegated-access:enable'}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-primary px-4 text-label-lg text-on-primary transition-transform active:scale-[0.97] disabled:opacity-50"
                >
                  <ShieldCheck aria-hidden className="h-4 w-4" />
                  {busy === 'delegated-access:enable' ? 'Enabling...' : 'Enable'}
                </button>
                <button
                  type="button"
                  onClick={() => void revokeDelegatedAccess()}
                  disabled={!connected || busy === 'delegated-access:revoke'}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-surface-container-low px-4 text-label-lg text-primary ring-1 ring-outline-variant transition-transform active:scale-[0.97] disabled:opacity-50"
                >
                  <ShieldOff aria-hidden className="h-4 w-4" />
                  {busy === 'delegated-access:revoke' ? 'Disabling...' : 'Disable'}
                </button>
              </div>
            </div>
            <LogBlock title="Delegated access log" entries={delegatedAccessLogs} compact />
          </Panel>

          <Panel title="Privy delegated Ultra swap" icon={<Play className="h-5 w-5" />}>
            <div className="flex flex-col gap-3">
              <div className="flex gap-2">
                <select
                  value={delegatedOrderId}
                  onChange={(event) => setDelegatedOrderId(event.target.value)}
                  className="min-w-0 flex-1 rounded-full bg-surface-container-low px-4 text-label-md text-primary outline-none ring-1 ring-outline-variant"
                >
                  <option value="">No order selected</option>
                  {delegatedOpenOrders.map((order) => (
                    <option key={order.id} value={order.id}>
                      {order.kind} {order.ticker} {fmtUsd(order.triggerPriceUsd)}
                    </option>
                  ))}
                </select>
                <IconButton
                  title="Refresh"
                  onClick={() => {
                    void refreshDevState();
                    void refreshDelegatedStatus({ log: false });
                  }}
                  icon={<RefreshCw className="h-4 w-4" />}
                />
              </div>
              {selectedDelegatedOrder && (
                <div className="rounded-md bg-surface-container-low p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-title-md text-primary">
                        {selectedDelegatedOrder.side} {selectedDelegatedOrder.ticker}
                      </p>
                      <p className="font-mono text-body-sm text-on-surface-variant">
                        {shortAddress(selectedDelegatedOrder.id)}
                      </p>
                    </div>
                    <span className="rounded-full bg-surface px-3 py-1 text-label-sm text-primary">
                      {selectedDelegatedOrder.kind}
                    </span>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-body-sm">
                    <Metric label="Input" value={fmtUsd(selectedDelegatedOrder.sizeUsd)} />
                    <Metric
                      label="Trigger"
                      value={fmtUsd(selectedDelegatedOrder.triggerPriceUsd)}
                    />
                    <Metric
                      label="Tokens"
                      value={selectedDelegatedOrder.tokenAmount?.toFixed(6) ?? 'Ultra quote'}
                    />
                    <Metric label="Status" value={selectedDelegatedOrder.status} />
                  </dl>
                </div>
              )}
              <DelegatedPreflightPanel report={delegatedPreflightPreview} />
              <button
                type="button"
                onClick={() => void runDelegatedUltraSwap()}
                disabled={!selectedDelegatedOrder || busy === 'delegated-swap:execute'}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-primary px-4 text-label-lg text-on-primary transition-transform active:scale-[0.97] disabled:opacity-50"
              >
                <Play aria-hidden className="h-4 w-4" />
                {busy === 'delegated-swap:execute' ? 'Executing...' : 'Execute swap'}
              </button>
              {delegatedUltraResult && <DelegatedUltraResult result={delegatedUltraResult} />}
            </div>
            <LogBlock title="Delegated Ultra swap log" entries={delegatedUltraLogs} compact />
          </Panel>

          <Panel title="Protection" icon={<SlidersHorizontal className="h-5 w-5" />}>
            <div className="flex flex-col gap-3">
              <select
                value={selectedPositionId}
                onChange={(event) => setSelectedPositionId(event.target.value)}
                className="h-12 rounded-full bg-surface-container-low px-4 text-label-md text-primary outline-none ring-1 ring-outline-variant"
              >
                <option value="">No active position</option>
                {activePositions.map((position) => (
                  <option key={position.id} value={position.id}>
                    {position.ticker} {position.tokenAmount.toFixed(4)}
                  </option>
                ))}
              </select>
              <div className="grid gap-3 sm:grid-cols-2">
                <LabeledInput label="TP" value={tpPrice} onChange={setTpPrice} />
                <LabeledInput label="SL" value={slPrice} onChange={setSlPrice} />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => void adjustProtection()}
                  disabled={!selectedPosition || busy === 'protection'}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-primary px-4 text-label-lg text-on-primary transition-transform active:scale-[0.97] disabled:opacity-50"
                >
                  <SlidersHorizontal aria-hidden className="h-4 w-4" />
                  Update TP/SL
                </button>
                <button
                  type="button"
                  onClick={() => void closePosition()}
                  disabled={!selectedPosition || busy === 'close'}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-negative px-4 text-label-lg text-on-negative transition-transform active:scale-[0.97] disabled:opacity-50"
                >
                  <Play aria-hidden className="h-4 w-4" />
                  Manual close
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {openOrders
                  .filter(
                    (order) =>
                      order.positionId === selectedPositionId && order.kind !== 'BUY_TRIGGER',
                  )
                  .map((order) => (
                    <button
                      key={order.id}
                      type="button"
                      onClick={() => void forceTrigger(order.id)}
                      disabled={busy === `force:${order.id}`}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-surface-container-low px-4 text-label-md text-primary ring-1 ring-outline-variant disabled:opacity-50"
                    >
                      <Zap aria-hidden className="h-4 w-4" />
                      {order.kind === 'TAKE_PROFIT' ? 'Force TP' : 'Force SL'}
                    </button>
                  ))}
              </div>
            </div>
            <LogBlock title="Protection log" entries={logs.protection} compact />
          </Panel>

          <Panel title="Logs" icon={<Clipboard className="h-5 w-5" />}>
            <LogReview
              selected={selectedLogView}
              onSelect={setSelectedLogView}
              logs={logs}
              allLogs={allLogs}
            />
          </Panel>
        </section>
      </main>
    </>
  );
}

function Panel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg bg-surface p-5 shadow-soft">
      <header className="mb-4 flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-container-low text-primary">
          {icon}
        </span>
        <h2 className="text-title-md text-primary">{title}</h2>
      </header>
      {children}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-label-sm text-on-surface-variant">{label}</dt>
      <dd className="mt-1 font-mono text-label-md text-primary">{value}</dd>
    </div>
  );
}

function DelegatedPreflightPanel({ report }: { report: DelegatedUltraPreflightReport }) {
  const riskCount = report.diagnostics.filter((item) => item.status === 'risk').length;
  const watchCount = report.diagnostics.filter((item) => item.status === 'watch').length;
  const visibleDiagnostics = report.diagnostics.slice(0, 8);

  return (
    <div className="rounded-md bg-surface-container-low p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-label-md text-primary">Preflight hypotheses</p>
          <p className="text-body-sm text-on-surface-variant">
            {riskCount > 0
              ? `${riskCount} blocker${riskCount === 1 ? '' : 's'} before execution`
              : `${watchCount} watch item${watchCount === 1 ? '' : 's'} to verify during execution`}
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-label-sm ${
            report.canAttempt
              ? 'bg-positive-container text-primary'
              : 'bg-error-container text-on-error-container'
          }`}
        >
          {report.canAttempt ? 'Can attempt' : 'Blocked'}
        </span>
      </div>
      {report.expectedInput && (
        <p className="mt-3 text-body-sm text-on-surface-variant">
          Expected input: {report.expectedInput.amount} {report.expectedInput.symbol}.
        </p>
      )}
      <div className="mt-3 flex flex-col gap-1">
        {visibleDiagnostics.map((item) => (
          <div key={`${item.hypothesis}-${item.status}`} className="min-w-0">
            <span
              className={`inline-flex max-w-full rounded-full px-2 py-1 text-left text-label-sm ${diagnosticStyles(item.status)}`}
            >
              <span className="truncate">
                {item.hypothesis}: {item.detail}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DelegatedUltraResult({ result }: { result: DelegatedUltraResponse }) {
  const delegated =
    result.wallet.delegated === true
      ? 'Delegated'
      : result.wallet.delegated === false
        ? 'Not delegated'
        : 'Unknown';
  const execution = result.execution;

  return (
    <div className="rounded-md bg-surface-container-low p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-title-md text-primary">{shortAddress(result.ultraOrder.requestId)}</p>
          <p className="text-body-sm text-on-surface-variant">{result.plan.side} via server key</p>
        </div>
        <span className="rounded-full bg-surface px-3 py-1 text-label-sm text-primary">
          {execution?.status ?? 'Executed'}
        </span>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-body-sm">
        <Metric label="Wallet" value={shortAddress(result.wallet.address)} />
        <Metric label="Delegation" value={delegated} />
        <Metric label="Auth" value={result.authorizationUsed.serverKey ? 'Server key' : 'None'} />
        <Metric
          label="Server key"
          value={result.authorizationUsed.serverKeyConfigured ? 'Configured' : 'Missing'}
        />
        <Metric label="Balance raw" value={result.balance.walletRaw} />
        <Metric label="Requested raw" value={result.balance.requestedRaw} />
        <Metric label="Submitted raw" value={result.balance.submittedRaw} />
        <Metric label="Router" value={result.ultraOrder.router ?? '-'} />
        <Metric
          label="Gasless"
          value={result.ultraOrder.gasless == null ? '-' : String(result.ultraOrder.gasless)}
        />
        <Metric label="Tx bytes" value={result.ultraOrder.transactionBytes.toString()} />
        <Metric
          label="Signers"
          value={`${result.ultraOrder.transactionShape.requiredSignatures} req / ${result.ultraOrder.transactionShape.zeroSignatureCount} blank`}
        />
        {result.signedTransaction && (
          <Metric
            label="Signed"
            value={`${result.signedTransaction.bytes} bytes / ${result.signedTransaction.transactionShape.zeroSignatureCount} blank`}
          />
        )}
        {execution && (
          <>
            <Metric label="Price" value={fmtUsd(execution.executionPrice)} />
            <Metric label="Tokens" value={execution.tokenAmount.toFixed(6)} />
            <Metric
              label="Signature"
              value={execution.signature ? shortAddress(execution.signature) : '-'}
            />
          </>
        )}
      </dl>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-label-sm text-on-surface-variant">
      {label}
      <input
        type="number"
        min="0"
        step="0.01"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-12 rounded-full bg-surface-container-low px-4 font-mono text-body-md text-primary outline-none ring-1 ring-outline-variant focus:ring-2 focus:ring-primary"
      />
    </label>
  );
}

function IconButton({
  title,
  icon,
  onClick,
}: {
  title: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-surface-container-low text-primary ring-1 ring-outline-variant transition-transform active:scale-[0.97]"
    >
      {icon}
    </button>
  );
}

function StatusPill({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-lg bg-surface px-4 py-3 shadow-micro">
      <div className="flex min-w-0 items-start gap-3 text-primary">
        {icon}
        <div className="min-w-0">
          <p className="text-label-sm text-on-surface-variant">{label}</p>
          <p className="mt-0.5 truncate text-label-lg text-primary">{value}</p>
          <p className="mt-1 truncate text-body-sm text-on-surface-variant">{detail}</p>
        </div>
      </div>
    </div>
  );
}

function LogReview({
  selected,
  onSelect,
  logs,
  allLogs,
}: {
  selected: LogView;
  onSelect: (view: LogView) => void;
  logs: Record<LogSection, LogEntry[]>;
  allLogs: LogEntry[];
}) {
  const views: LogView[] = [...LOG_SECTIONS, 'all'];
  const entries = selected === 'all' ? allLogs : logs[selected];
  const text = logToText(entries);
  const title = selected === 'all' ? 'All logs' : `${LOG_LABELS[selected]} log`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {views.map((view) => {
          const count = view === 'all' ? allLogs.length : logs[view].length;
          const active = selected === view;
          return (
            <button
              key={view}
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(view)}
              className={`inline-flex h-9 items-center justify-center gap-2 rounded-full px-3 text-label-md ring-1 transition-colors ${
                active
                  ? 'bg-primary text-on-primary ring-primary'
                  : 'bg-surface-container-low text-primary ring-outline-variant'
              }`}
            >
              {view === 'all' ? 'All' : LOG_LABELS[view]}
              <span
                className={`rounded-full px-2 py-0.5 text-label-sm ${
                  active ? 'bg-on-primary text-primary' : 'bg-surface text-on-surface-variant'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>
      <div className="rounded-md bg-surface-container-low p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-label-md text-primary">{title}</h3>
            <p className="text-body-sm text-on-surface-variant">
              {entries.length} {entries.length === 1 ? 'entry' : 'entries'} captured.
            </p>
          </div>
          <CopyButton
            label={`copy ${selected === 'all' ? 'all' : LOG_LABELS[selected].toLowerCase()}`}
            text={text}
          />
        </div>
        <LogEntryList entries={entries} maxHeightClass="max-h-96" />
      </div>
    </div>
  );
}

function LogBlock({
  title,
  entries,
  compact,
}: {
  title: string;
  entries: LogEntry[];
  compact?: boolean;
}) {
  const text = logToText(entries);
  return (
    <div className={compact ? 'mt-4' : 'mt-5'}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-label-md text-on-surface-variant">{title}</h3>
        <CopyButton label="copy" text={text} />
      </div>
      <LogEntryList entries={entries} maxHeightClass={compact ? 'max-h-48' : 'max-h-72'} />
    </div>
  );
}

function LogEntryList({
  entries,
  maxHeightClass,
}: {
  entries: LogEntry[];
  maxHeightClass: string;
}) {
  if (entries.length === 0) {
    return (
      <div className="rounded-md bg-surface px-3 py-4 text-body-sm text-on-surface-variant">
        No log entries yet.
      </div>
    );
  }

  return (
    <ul className={`${maxHeightClass} overflow-auto rounded-md bg-surface`}>
      {entries.map((entry) => (
        <LogEntryRow key={`${entry.requestId}-${entry.step}`} entry={entry} />
      ))}
    </ul>
  );
}

function severityStyles(severity: LogSeverity): { dot: string; badge: string; label: string } {
  if (severity === 'error') {
    return {
      dot: 'bg-error',
      badge: 'bg-error-container text-on-error-container',
      label: 'error',
    };
  }
  if (severity === 'warning') {
    return {
      dot: 'bg-tertiary',
      badge: 'bg-tertiary-container text-on-tertiary-container',
      label: 'watch',
    };
  }
  if (severity === 'success') {
    return {
      dot: 'bg-positive',
      badge: 'bg-positive-container text-primary',
      label: 'ok',
    };
  }
  return {
    dot: 'bg-icon-muted',
    badge: 'bg-surface-container-low text-on-surface-variant',
    label: 'info',
  };
}

function diagnosticStyles(status: DiagnosticStatus): string {
  if (status === 'healthy') return 'bg-positive-container text-primary';
  if (status === 'risk') return 'bg-error-container text-on-error-container';
  if (status === 'watch') return 'bg-tertiary-container text-on-tertiary-container';
  return 'bg-surface-container-low text-on-surface-variant';
}

function entryDetailsText(entry: LogEntry): string {
  return stringify({
    payload: entry.payload,
    response: entry.response,
    error: entry.error,
    errorDetail: entry.errorDetail,
  });
}

function LogEntryRow({ entry }: { entry: LogEntry }) {
  const styles = severityStyles(entry.severity);
  const details = entryDetailsText(entry);
  const time = new Date(entry.timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <li className="border-b border-outline-variant px-3 py-3 last:border-b-0">
      <div className="flex min-w-0 items-start gap-3">
        <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${styles.dot}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-label-md text-primary">{entry.step}</span>
            <span className={`rounded-full px-2 py-0.5 text-label-sm ${styles.badge}`}>
              {styles.label}
            </span>
            <span className="font-mono text-label-sm text-on-surface-variant">
              {entry.latencyMs}ms
            </span>
            <span className="font-mono text-label-sm text-on-surface-variant">{time}</span>
          </div>
          <p className="mt-1 text-body-sm text-primary">{entry.summary}</p>
          {entry.diagnostics.length > 0 && (
            <div className="mt-2 flex flex-col gap-1">
              {entry.diagnostics.map((item) => (
                <div key={`${entry.requestId}-${item.hypothesis}`} className="min-w-0">
                  <span
                    className={`inline-flex max-w-full rounded-full px-2 py-1 text-left text-label-sm ${diagnosticStyles(item.status)}`}
                  >
                    <span className="truncate">
                      {item.hypothesis}: {item.detail}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
          <details className="mt-2">
            <summary className="cursor-pointer text-label-sm text-on-surface-variant">
              Details
            </summary>
            <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-primary p-3 text-[11px] leading-4 text-on-primary">
              {details}
            </pre>
          </details>
        </div>
      </div>
    </li>
  );
}

function CopyButton({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={`Copy ${label}`}
      onClick={() => {
        void navigator.clipboard.writeText(text || '[]').then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      className="inline-flex h-9 items-center justify-center gap-2 rounded-full bg-surface-container-low px-3 text-label-md text-primary ring-1 ring-outline-variant"
    >
      {copied ? (
        <Check aria-hidden className="h-3.5 w-3.5" />
      ) : (
        <Clipboard aria-hidden className="h-3.5 w-3.5" />
      )}
      {label}
    </button>
  );
}
