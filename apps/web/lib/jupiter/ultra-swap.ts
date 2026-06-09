import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { parseRpcUrls, TOKEN_2022_PROGRAM_ID, USDC_DECIMALS, USDC_MINT } from '@hunch-it/shared';
import {
  executeUltraOrder,
  requestUltraOrder,
  type UltraExecuteResponse,
  type UltraOrderResponse,
} from '@/lib/jupiter';

function toBase64(bytes: Uint8Array): string {
  if (typeof window === 'undefined') return Buffer.from(bytes).toString('base64');
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i] ?? 0);
  return window.btoa(binary);
}
function fromBase64(str: string): Uint8Array {
  if (typeof window === 'undefined') return new Uint8Array(Buffer.from(str, 'base64'));
  const binary = window.atob(str);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return arr;
}
// Jupiter Ultra /execute accepts the signed transaction as base64.

const BLOCKHASH_WARN_MS = 15_000;
const BLOCKHASH_RISK_MS = 30_000;
const BLOCKHASH_REFRESH_MS = 45_000;
const BLOCKHASH_CHECK_TIMEOUT_MS = 900;
const BLOCKHASH_CHECK_RPC_LIMIT = 3;
const PRE_BROADCAST_SIMULATION_TIMEOUT_MS = 2_500;
const PRE_BROADCAST_SIMULATION_RPC_LIMIT = 3;
const PROGRAM_ID_SAMPLE_LIMIT = 10;
const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const SELL_BALANCE_TOKEN_PROGRAM_IDS = [SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID] as const;

export type BlockhashAgeBucket = 'healthy' | 'warn' | 'risk' | 'refresh-recommended' | 'unknown';

export interface BlockhashValidityDiagnostic {
  index: number;
  rpc: string;
  isPrivyPrimary: boolean;
  valid: boolean | null;
  contextSlot: number | null;
  latencyMs: number;
  error: string | null;
}

export interface SwapSellBalanceDebug {
  walletRaw: string;
  requestedRaw: string | null;
  submittedRaw: string;
  tokenProgramIds: string[];
  balancePrograms: TokenProgramBalanceDebug[];
}

export interface TokenProgramBalanceDebug {
  programId: string;
  walletRaw: string | null;
  accountCount: number | null;
  error: string | null;
}

export interface TokenMintBalanceRead {
  raw: bigint;
  programIds: string[];
  programs: TokenProgramBalanceDebug[];
}

export interface TokenAccountBalanceConnection {
  getParsedTokenAccountsByOwner(
    owner: PublicKey,
    filter: { programId: PublicKey },
  ): Promise<{ value: Array<{ account: { data: unknown } }> }>;
}

export interface TransactionShapeDebug {
  version: string;
  signatureCount: number;
  zeroSignatureCount: number;
  requiredSignatures: number;
  readonlySignedAccounts: number;
  readonlyUnsignedAccounts: number;
  staticAccountKeys: number;
  addressTableLookups: number;
  compiledInstructions: number;
  feePayer: string | null;
  signerKeys: string[];
  instructionProgramIds: string[];
}

export interface PreBroadcastSimulationDiagnostic {
  index: number;
  rpc: string;
  isPrivyPrimary: boolean;
  err: string | null;
  logsCount: number | null;
  logsSample: string[] | null;
  unitsConsumed: number | null;
  contextSlot: number | null;
  latencyMs: number;
  error: string | null;
}

export type SwapDiagnosticsMode = 'off' | 'summary' | 'probes';

export interface SwapDiagnosticsOptions {
  source?: string;
  /**
   * `summary` records cheap execution metadata. `probes` also performs
   * active RPC diagnostics such as blockhash checks and unsigned simulation.
   */
  mode?: SwapDiagnosticsMode;
  /** @deprecated Use mode: 'probes'. Kept while older callers migrate. */
  checkBlockhash?: boolean;
}

export interface SwapResult {
  order: UltraOrderResponse;
  exec: UltraExecuteResponse;
  inputMint: string;
  outputMint: string;
  /** Token-units of the input asset that were sent. */
  inputAmount: string;
  /** Token-units of the output asset that should arrive. */
  outputAmount: string;
  debug: JupiterSwapDebug;
}

export type JupiterSwapPhase = 'prepare' | 'balance' | 'order' | 'deserialize' | 'sign' | 'execute';

export interface SwapQuoteGuardInput {
  order: UltraOrderResponse;
  inputMint: string;
  outputMint: string;
  amount: string;
}

export type JupiterSwapLoading = 'order' | 'sign' | 'execute' | null;

export interface JupiterUltraSwapDeps {
  connection: Connection;
  publicKey: PublicKey;
  signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>;
  rpcUrls?: string[];
  onLoadingChange?: (loading: JupiterSwapLoading) => void;
  onOrder?: (order: UltraOrderResponse) => void;
}

export interface JupiterSwapDebug {
  phase: JupiterSwapPhase;
  direction: SwapDirection;
  xStockMint: string;
  inputMint: string | null;
  outputMint: string | null;
  amount: string | null;
  taker: string | null;
  orderRequestId: string | null;
  orderInAmount: string | null;
  orderOutAmount: string | null;
  otherAmountThreshold: string | null;
  priceImpactPct: string | null;
  diagnosticsSource: string | null;
  selectedPrivyRpc: string | null;
  rpcUrls: string[];
  orderFetchedAt: string | null;
  orderLatencyMs: number | null;
  deserializedAt: string | null;
  transactionBytes: number | null;
  transactionShape: TransactionShapeDebug | null;
  recentBlockhash: string | null;
  blockhashValidity: BlockhashValidityDiagnostic[] | null;
  preBroadcastSimulation: PreBroadcastSimulationDiagnostic[] | null;
  broadcastStartedAt: string | null;
  broadcastEndedAt: string | null;
  broadcastLatencyMs: number | null;
  orderAgeMsAtBroadcast: number | null;
  orderAgeBucket: BlockhashAgeBucket;
  signedTransactionBytes: number | null;
  signedTransactionShape: TransactionShapeDebug | null;
  executeStatus: UltraExecuteResponse['status'] | null;
  executeError: string | null;
  signature: string | null;
  sellBalance: SwapSellBalanceDebug | null;
  originalMessage: string;
}

export class JupiterSwapError extends Error {
  constructor(
    message: string,
    public readonly debug: JupiterSwapDebug,
    public readonly originalError: unknown,
  ) {
    super(message);
    this.name = 'JupiterSwapError';
  }
}

export type SwapDirection = 'BUY' | 'SELL';

interface BuyArgs {
  direction: 'BUY';
  xStockMint: string;
  xStockDecimals: number;
  /** USD amount of USDC to spend. */
  usdAmount: number;
}
interface SellAllArgs {
  direction: 'SELL';
  xStockMint: string;
  xStockDecimals: number;
  /** Drain the wallet's full xStock balance. Bypasses DB and reads from
   *  the chain — use only for "panic close everything" / dev-tools paths
   *  where the user explicitly wants the wallet emptied of the mint. */
  sellAll: true;
}
interface SellAmountArgs {
  direction: 'SELL';
  xStockMint: string;
  xStockDecimals: number;
  /** Sell exactly this many xStock token units (decimals already
   *  applied — i.e. position.tokenAmount). Use this for closing a
   *  specific Position so we don't accidentally sweep dust or other
   *  positions in the same mint that happen to share the wallet. */
  tokenAmount: number;
}
export type SwapArgs = (BuyArgs | SellAllArgs | SellAmountArgs) & {
  diagnostics?: SwapDiagnosticsOptions;
  quoteGuard?: (input: SwapQuoteGuardInput) => void;
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function stringifySmall(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, (_key, item) =>
      typeof item === 'bigint' ? `${item.toString()}n` : item,
    );
  } catch {
    return String(value);
  }
}

function maskRpcUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const hasPathSecret = parsed.pathname !== '' && parsed.pathname !== '/';
    return `${parsed.protocol}//${parsed.host}${hasPathSecret ? '/...' : ''}`;
  } catch {
    return url.length > 48 ? `${url.slice(0, 24)}...${url.slice(-12)}` : url;
  }
}

function blockhashAgeBucket(ms: number | null): BlockhashAgeBucket {
  if (ms == null) return 'unknown';
  if (ms < BLOCKHASH_WARN_MS) return 'healthy';
  if (ms < BLOCKHASH_RISK_MS) return 'warn';
  if (ms < BLOCKHASH_REFRESH_MS) return 'risk';
  return 'refresh-recommended';
}

function diagnosticsMode(options: SwapDiagnosticsOptions | undefined): SwapDiagnosticsMode {
  if (options?.mode) return options.mode;
  if (options?.checkBlockhash) return 'probes';
  return 'summary';
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function checkBlockhashValidity(
  blockhash: string,
  rpcUrls: string[],
  primaryConnection: Connection,
): Promise<BlockhashValidityDiagnostic[]> {
  const targets = rpcUrls.slice(0, BLOCKHASH_CHECK_RPC_LIMIT);
  const checks = targets.map(async (url, index): Promise<BlockhashValidityDiagnostic> => {
    const startedAt = performance.now();
    try {
      const rpc =
        index === 0 ? primaryConnection : new Connection(url, { commitment: 'confirmed' });
      const result = await withTimeout(
        rpc.isBlockhashValid(blockhash, { commitment: 'processed' }),
        BLOCKHASH_CHECK_TIMEOUT_MS,
      );
      return {
        index,
        rpc: maskRpcUrl(url),
        isPrivyPrimary: index === 0,
        valid: result.value,
        contextSlot: result.context.slot,
        latencyMs: Math.round(performance.now() - startedAt),
        error: null,
      };
    } catch (err) {
      return {
        index,
        rpc: maskRpcUrl(url),
        isPrivyPrimary: index === 0,
        valid: null,
        contextSlot: null,
        latencyMs: Math.round(performance.now() - startedAt),
        error: errorMessage(err),
      };
    }
  });

  return Promise.all(checks);
}

function describeTransaction(tx: VersionedTransaction): TransactionShapeDebug {
  const message = tx.message as VersionedTransaction['message'] & {
    staticAccountKeys?: PublicKey[];
    accountKeys?: PublicKey[];
    compiledInstructions?: Array<{ programIdIndex: number }>;
    instructions?: Array<{ programIdIndex: number }>;
    addressTableLookups?: unknown[];
  };
  const staticKeys = message.staticAccountKeys ?? message.accountKeys ?? [];
  const compiledInstructions = message.compiledInstructions ?? message.instructions ?? [];
  const header = tx.message.header;
  const requiredSignatures = header.numRequiredSignatures;
  const signerKeys = staticKeys.slice(0, requiredSignatures).map((key) => key.toBase58());
  const instructionProgramIds = compiledInstructions
    .slice(0, PROGRAM_ID_SAMPLE_LIMIT)
    .map((instruction) => {
      const key = staticKeys[instruction.programIdIndex];
      return key ? key.toBase58() : `lookup-account-index-${instruction.programIdIndex}`;
    });

  return {
    version: String(tx.version),
    signatureCount: tx.signatures.length,
    zeroSignatureCount: tx.signatures.filter((signature) => signature.every((byte) => byte === 0))
      .length,
    requiredSignatures,
    readonlySignedAccounts: header.numReadonlySignedAccounts,
    readonlyUnsignedAccounts: header.numReadonlyUnsignedAccounts,
    staticAccountKeys: staticKeys.length,
    addressTableLookups: message.addressTableLookups?.length ?? 0,
    compiledInstructions: compiledInstructions.length,
    feePayer: staticKeys[0]?.toBase58() ?? null,
    signerKeys,
    instructionProgramIds,
  };
}

async function simulatePreBroadcastTransaction(
  tx: VersionedTransaction,
  rpcUrls: string[],
  primaryConnection: Connection,
): Promise<PreBroadcastSimulationDiagnostic[]> {
  const targets = rpcUrls.slice(0, PRE_BROADCAST_SIMULATION_RPC_LIMIT);
  const simulations = targets.map(async (url, index): Promise<PreBroadcastSimulationDiagnostic> => {
    const startedAt = performance.now();
    try {
      const rpc =
        index === 0 ? primaryConnection : new Connection(url, { commitment: 'confirmed' });
      const result = await withTimeout(
        rpc.simulateTransaction(tx, {
          sigVerify: false,
          replaceRecentBlockhash: false,
          commitment: 'processed',
          innerInstructions: true,
        }),
        PRE_BROADCAST_SIMULATION_TIMEOUT_MS,
      );
      const logs = result.value.logs ?? null;
      return {
        index,
        rpc: maskRpcUrl(url),
        isPrivyPrimary: index === 0,
        err: result.value.err ? stringifySmall(result.value.err) : null,
        logsCount: logs?.length ?? null,
        logsSample: logs?.slice(0, 8) ?? null,
        unitsConsumed: result.value.unitsConsumed ?? null,
        contextSlot: result.context.slot,
        latencyMs: Math.round(performance.now() - startedAt),
        error: null,
      };
    } catch (err) {
      return {
        index,
        rpc: maskRpcUrl(url),
        isPrivyPrimary: index === 0,
        err: null,
        logsCount: null,
        logsSample: null,
        unitsConsumed: null,
        contextSlot: null,
        latencyMs: Math.round(performance.now() - startedAt),
        error: errorMessage(err),
      };
    }
  });

  return Promise.all(simulations);
}

function parsedTokenAccountRawAmount(
  account: { account: { data: unknown } },
  mint: string,
): bigint | null {
  const data = account.account.data;
  if (!data || typeof data !== 'object' || !('parsed' in data)) return null;
  const parsed = (
    data as { parsed?: { info?: { mint?: unknown; tokenAmount?: { amount?: unknown } } } }
  ).parsed;
  if (parsed?.info?.mint !== mint) return null;

  const raw = parsed.info.tokenAmount?.amount;
  if (raw == null) return 0n;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
    throw new Error(`Invalid token balance amount for ${mint}: ${String(raw)}`);
  }
  return BigInt(raw);
}

export async function readOwnerMintBalanceRaw(
  connection: TokenAccountBalanceConnection,
  owner: PublicKey,
  mint: string,
): Promise<TokenMintBalanceRead> {
  const programs: TokenProgramBalanceDebug[] = [];

  for (const programId of SELL_BALANCE_TOKEN_PROGRAM_IDS) {
    try {
      const accounts = await connection.getParsedTokenAccountsByOwner(owner, {
        programId: new PublicKey(programId),
      });
      let raw = 0n;
      let accountCount = 0;
      for (const account of accounts.value) {
        const accountRaw = parsedTokenAccountRawAmount(account, mint);
        if (accountRaw == null) continue;
        accountCount += 1;
        raw += accountRaw;
      }
      programs.push({
        programId,
        walletRaw: raw.toString(),
        accountCount,
        error: null,
      });
    } catch (err) {
      programs.push({
        programId,
        walletRaw: null,
        accountCount: null,
        error: errorMessage(err),
      });
    }
  }

  const successfulPrograms = programs.filter((program) => program.error == null);
  if (successfulPrograms.length === 0) {
    const detail = programs
      .map((program) => `${program.programId}: ${program.error ?? 'unknown error'}`)
      .join('; ');
    throw new Error(`Token balance lookup failed for ${mint}: ${detail}`);
  }

  const raw = successfulPrograms.reduce(
    (acc, program) => acc + BigInt(program.walletRaw ?? '0'),
    0n,
  );
  const failedPrograms = programs.filter((program) => program.error != null);
  if (raw === 0n && failedPrograms.length > 0) {
    const detail = failedPrograms
      .map((program) => `${program.programId}: ${program.error ?? 'unknown error'}`)
      .join('; ');
    throw new Error(`Token balance lookup incomplete for ${mint}: ${detail}`);
  }

  const programIds = successfulPrograms
    .filter((program) => BigInt(program.walletRaw ?? '0') > 0n)
    .map((program) => program.programId);

  return { raw, programIds, programs };
}

/**
 * Sponsored Jupiter Ultra swap implementation.
 *
 * Interface invariant: callers provide a signer that can sign the user's
 * VersionedTransaction slot. This module never direct-broadcasts via the
 * wallet; it returns signed bytes to Jupiter Ultra `/execute`.
 */
export async function executeJupiterUltraSwap(
  args: SwapArgs,
  deps: JupiterUltraSwapDeps,
): Promise<SwapResult> {
  const { connection, publicKey, signTransaction } = deps;
  const setLoading = deps.onLoadingChange ?? (() => {});
  const rpcUrls = deps.rpcUrls ?? parseRpcUrls(process.env.NEXT_PUBLIC_SOLANA_RPC_URLS);
  if (!args.xStockMint) throw new Error('xStock mint address is empty');

  let phase: JupiterSwapPhase = 'prepare';
  let inputMint: string | null = null;
  let outputMint: string | null = null;
  let amount: string | null = null;
  let order: UltraOrderResponse | null = null;
  const taker = publicKey.toBase58();
  const activeDiagnosticsMode = diagnosticsMode(args.diagnostics);
  const debug: JupiterSwapDebug = {
    phase,
    direction: args.direction,
    xStockMint: args.xStockMint,
    inputMint,
    outputMint,
    amount,
    taker,
    orderRequestId: null,
    orderInAmount: null,
    orderOutAmount: null,
    otherAmountThreshold: null,
    priceImpactPct: null,
    diagnosticsSource: args.diagnostics?.source ?? null,
    selectedPrivyRpc: rpcUrls[0] ? maskRpcUrl(rpcUrls[0]) : null,
    rpcUrls: rpcUrls.map(maskRpcUrl),
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
    executeStatus: null,
    executeError: null,
    signature: null,
    sellBalance: null,
    originalMessage: '',
  };
  let orderFetchedAtMs: number | null = null;
  let broadcastStartedAtMs: number | null = null;

  const setPhase = (next: JupiterSwapPhase) => {
    phase = next;
    debug.phase = next;
  };
  const updatePreparedFields = () => {
    debug.inputMint = inputMint;
    debug.outputMint = outputMint;
    debug.amount = amount;
  };

  try {
    if (args.direction === 'BUY') {
      inputMint = USDC_MINT;
      outputMint = args.xStockMint;
      amount = Math.round(args.usdAmount * 10 ** USDC_DECIMALS).toString();
      updatePreparedFields();
    } else if ('tokenAmount' in args) {
      setPhase('balance');
      // Targeted SELL: caller specified exactly how many xStock units to
      // sell (typically position.tokenAmount). We still cap at the wallet
      // balance to avoid an Ultra failure if the chain has less than the
      // DB thinks (e.g. a separate manual transfer happened).
      const balance = await readOwnerMintBalanceRaw(connection, publicKey, args.xStockMint);
      const walletRaw = balance.raw;
      const wantRaw = BigInt(Math.round(args.tokenAmount * 10 ** args.xStockDecimals));
      const sellRaw = wantRaw < walletRaw ? wantRaw : walletRaw;
      if (sellRaw === 0n) throw new Error(`No token balance for ${args.xStockMint}`);
      inputMint = args.xStockMint;
      outputMint = USDC_MINT;
      amount = sellRaw.toString();
      debug.sellBalance = {
        walletRaw: walletRaw.toString(),
        requestedRaw: wantRaw.toString(),
        submittedRaw: sellRaw.toString(),
        tokenProgramIds: balance.programIds,
        balancePrograms: balance.programs,
      };
      updatePreparedFields();
    } else {
      setPhase('balance');
      // sellAll: drain whatever's in the wallet for this mint. Reserved
      // for panic-close-balance flows where the user explicitly wants the
      // wallet emptied — closePosition() does NOT use this path because
      // it would sweep unrelated dust / other positions that share the
      // same mint.
      const balance = await readOwnerMintBalanceRaw(connection, publicKey, args.xStockMint);
      const raw = balance.raw.toString();
      if (balance.raw === 0n) throw new Error(`No token balance for ${args.xStockMint}`);
      inputMint = args.xStockMint;
      outputMint = USDC_MINT;
      amount = raw;
      debug.sellBalance = {
        walletRaw: raw,
        requestedRaw: null,
        submittedRaw: raw,
        tokenProgramIds: balance.programIds,
        balancePrograms: balance.programs,
      };
      updatePreparedFields();
    }

    if (!inputMint || !outputMint || !amount) {
      throw new Error('swap amount not prepared');
    }

    setPhase('order');
    setLoading('order');
    const orderStartedAtMs = performance.now();
    order = await requestUltraOrder({
      inputMint,
      outputMint,
      amount,
      taker,
    });
    orderFetchedAtMs = performance.now();
    debug.orderFetchedAt = new Date().toISOString();
    debug.orderLatencyMs = Math.round(orderFetchedAtMs - orderStartedAtMs);
    debug.orderRequestId = order.requestId;
    debug.orderInAmount = order.inAmount;
    debug.orderOutAmount = order.outAmount;
    debug.otherAmountThreshold = order.otherAmountThreshold;
    debug.priceImpactPct = order.priceImpactPct;
    deps.onOrder?.(order);
    args.quoteGuard?.({
      order,
      inputMint,
      outputMint,
      amount,
    });

    setPhase('deserialize');
    setLoading('sign');
    const txBytes = fromBase64(order.transaction);
    debug.transactionBytes = txBytes.byteLength;
    const tx = VersionedTransaction.deserialize(txBytes);
    debug.recentBlockhash = tx.message.recentBlockhash;
    debug.transactionShape = describeTransaction(tx);
    debug.deserializedAt = new Date().toISOString();

    if (activeDiagnosticsMode === 'probes') {
      const [blockhashValidity, preBroadcastSimulation] = await Promise.all([
        debug.recentBlockhash
          ? checkBlockhashValidity(debug.recentBlockhash, rpcUrls, connection)
          : Promise.resolve(null),
        simulatePreBroadcastTransaction(tx, rpcUrls, connection),
      ]);
      debug.blockhashValidity = blockhashValidity;
      debug.preBroadcastSimulation = preBroadcastSimulation;
    }

    // Ultra gas-sponsored orders have two required signers: Jupiter's
    // gas payer and the taker. Privy can only sign the taker slot, so a
    // direct sign+send fails RPC signature verification before execution.
    // Sign only the user's slot, then let Jupiter /execute complete the
    // sponsored transaction and relay it.
    setPhase('sign');
    setLoading('sign');
    const signedTx = await signTransaction(tx);
    const signedTxBytes = signedTx.serialize();
    debug.signedTransactionBytes = signedTxBytes.byteLength;
    debug.signedTransactionShape = describeTransaction(signedTx);

    setPhase('execute');
    setLoading('execute');
    broadcastStartedAtMs = performance.now();
    debug.broadcastStartedAt = new Date().toISOString();
    debug.orderAgeMsAtBroadcast =
      orderFetchedAtMs == null ? null : Math.round(broadcastStartedAtMs - orderFetchedAtMs);
    debug.orderAgeBucket = blockhashAgeBucket(debug.orderAgeMsAtBroadcast);
    const exec = await executeUltraOrder({
      requestId: order.requestId,
      signedTransaction: toBase64(signedTxBytes),
    });
    debug.broadcastEndedAt = new Date().toISOString();
    debug.broadcastLatencyMs = Math.round(performance.now() - broadcastStartedAtMs);
    debug.executeStatus = exec.status;
    debug.executeError = exec.error ?? null;
    debug.signature = exec.signature ?? null;
    if (exec.status !== 'Success') {
      throw new Error(exec.error ?? 'Jupiter Ultra /execute failed');
    }

    setLoading(null);
    return {
      order,
      exec,
      inputMint,
      outputMint,
      inputAmount: order.inAmount,
      outputAmount: order.outAmount,
      debug,
    };
  } catch (err) {
    setLoading(null);
    const originalMessage = errorMessage(err);
    if (broadcastStartedAtMs != null && debug.broadcastEndedAt == null) {
      debug.broadcastEndedAt = new Date().toISOString();
      debug.broadcastLatencyMs = Math.round(performance.now() - broadcastStartedAtMs);
    }
    debug.phase = phase;
    debug.originalMessage = originalMessage;
    updatePreparedFields();
    if (order) {
      debug.orderRequestId = order.requestId;
      debug.orderInAmount = order.inAmount;
      debug.orderOutAmount = order.outAmount;
      debug.otherAmountThreshold = order.otherAmountThreshold;
      debug.priceImpactPct = order.priceImpactPct;
    }
    throw new JupiterSwapError(`${phase} failed: ${originalMessage}`, debug, err);
  }
}
