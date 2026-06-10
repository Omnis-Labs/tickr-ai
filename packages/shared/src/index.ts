// Explicit re-exports work better with Turbopack's cross-workspace resolver
// than `export *` (it sometimes drops named exports during HMR).

// ── v1.3 mandate / proposal / skip / position / order / trade ────────────
export {
  HoldingPeriodSchema,
  MarketFocusVerticalSchema,
  MandateInputSchema,
  MandateSchema,
  ProposalActionSchema,
  ProposalOriginSchema,
  ProposalStatusSchema,
  ProposalOutcomeSchema,
  ProposalReasoningSchema,
  ProposalSchema,
  PositionImpactSchema,
  PositionStateSchema,
  OrderKindSchema,
  OrderStatusSchema,
  TradeSourceSchema,
  SkipReasonSchema,
  SkipInputSchema,
} from './types.js';
export type {
  HoldingPeriod,
  MarketFocusVertical,
  MandateInput,
  Mandate,
  ProposalAction,
  ProposalOrigin,
  ProposalStatus,
  ProposalOutcome,
  ProposalReasoning,
  Proposal,
  PositionImpact,
  PositionState,
  OrderKind,
  OrderStatus,
  TradeSource,
  SkipReason,
  SkipInput,
} from './types.js';

// ── legacy v1.2 signal types ─────────────────────────────────────────────
export {
  ApprovalDecisionPayloadSchema,
  ApprovalSchema,
  AuthPayloadSchema,
  BarSchema,
  IndicatorSnapshotSchema,
  LlmSignalOutputSchema,
  PositionSchema,
  PriceSnapshotSchema,
  SignalActionSchema,
  SignalSchema,
  TradeSchema,
  TradeStatusSchema,
  TradeFilledPayloadSchema,
  TriggerHitPayloadSchema,
  TriggerWakePayloadSchema,
  WsClientEvents,
  WsServerEvents,
} from './types.js';
export type {
  ApprovalDecisionPayload,
  Approval,
  AuthPayload,
  Bar,
  IndicatorSnapshot,
  LlmSignalOutput,
  Position,
  PriceSnapshot,
  Signal,
  SignalAction,
  Trade,
  TradeStatus,
  TradeFilledPayload,
  TriggerHitPayload,
  TriggerWakePayload,
} from './types.js';

// ── constants ────────────────────────────────────────────────────────────
export {
  HOLDING_PERIOD_OPTIONS,
  JUPITER_ULTRA_EXECUTE,
  JUPITER_ULTRA_ORDER,
  MARKET_FOCUS_VERTICALS,
  MAX_DRAWDOWN_OPTIONS,
  MIN_ACTIONABLE_CONFIDENCE,
  PYTH_BENCHMARKS_BASE,
  PYTH_FEED_IDS,
  PYTH_HERMES_DEFAULT_URL,
  SIGNAL_TTL_DEFAULT,
  SIGNAL_TTL_MAX,
  SIGNAL_TTL_MIN,
  SKIP_REASON_LABELS,
  TOKEN_2022_PROGRAM_ID,
  USDC_DECIMALS,
  USDC_MINT,
  XSTOCK_MINTS,
  XSTOCK_TICKERS,
  XSTOCKS,
  requireMint,
  requirePythFeedId,
  solscanTokenUrl,
} from './constants.js';
export type {
  DrawdownOption,
  HoldingPeriodOption,
  MarketFocusVerticalDef,
  XStockMeta,
  XStockTicker,
} from './constants.js';

// ── Asset registry (preferred lookup for new code) ───────────────────────
export {
  ASSET_REGISTRY,
  getCryptoAssets,
  getMarketFocusVerticalsForAsset,
  getAssetById,
  getSignalAssetIdsForMarketFocus,
  getSignalAssetIdsForVerticals,
  getSignalAssets,
  getXStockAssets,
  isCrypto,
  isSignalAsset,
  isXStock,
  requireAsset,
} from './assets.js';
export type { Asset, AssetId, AssetKind, CryptoAssetId } from './assets.js';

// ── Signal data freshness ────────────────────────────────────────────────
export { SIGNAL_DATA_MAX_AGE_SECONDS, evaluateSignalDataFreshness } from './signal-data.js';
export type { SignalDataFreshnessVerdict } from './signal-data.js';

// ── Pyth Benchmarks bars ────────────────────────────────────────────────
export {
  PYTH_BENCHMARK_CHART_INTRADAY_CLIENT_SETTINGS,
  PYTH_BENCHMARK_DEV_TOOLS_INTRADAY_CLIENT_SETTINGS,
  PYTH_BENCHMARK_GRILL_DAILY_CLIENT_SETTINGS,
  PYTH_BENCHMARK_PUBLIC_REQUEST_SPACING_MS,
  PYTH_BENCHMARK_SIGNAL_INTRADAY_CLIENT_SETTINGS,
  PythBenchmarkRequestError,
  createPythBenchmarkBarsClient,
} from './pyth-benchmarks.js';
export type {
  CreatePythBenchmarkBarsClientInput,
  PythBenchmarkBarsClient,
  PythBenchmarkBarsRequestOptions,
  PythBenchmarkClientSettings,
  PythBenchmarkCacheMode,
  PythBenchmarkFetch,
  PythBenchmarkFetchResponse,
  PythBenchmarkIntradayResolution,
  PythBenchmarkResolution,
} from './pyth-benchmarks.js';

// ── Pyth latest prices ──────────────────────────────────────────────────
export {
  PYTH_LATEST_PRICE_FEED_IDS_PER_REQUEST,
  chunkPythLatestPriceFeedIds,
  createPythLatestPriceClient,
  PythLatestPriceRequestError,
} from './pyth-latest-prices.js';
export type {
  CreatePythLatestPriceClientInput,
  PythLatestPriceCacheMode,
  PythLatestPriceClient,
  PythLatestPriceFetch,
  PythLatestPriceFetchResponse,
} from './pyth-latest-prices.js';

// ── Signal Engine boundary ──────────────────────────────────────────────
export {
  baseMarketIndicatorsToSnapshot,
  buildBaseMarketAnalysis,
  snapshotToBaseMarketIndicators,
} from './signal-engine.js';
export type {
  BaseMarketAnalysis,
  BaseMarketIndicators,
  BuildBaseMarketAnalysisInput,
} from './signal-engine.js';

// ── Thesis tags (BUY rationale ↔ SELL re-check) ──────────────────────────
export { THESIS_TAGS, evaluateThesis, extractThesisTags, getThesisTag } from './thesis.js';
export type { ThesisEvaluation, ThesisIndicatorSnapshot, ThesisTagDef } from './thesis.js';

// ── RPC helpers ──────────────────────────────────────────────────────────
export { createRpcRoundRobin, parseRpcUrls } from './rpc.js';

// ── Synthetic Order execution helpers ───────────────────────────────────
export {
  buildTriggerUltraSwapPlan,
  closePositionExecutionEvidence,
  executableTriggerDecision,
  pythWakeUpBandHit,
  settlementAmountsForTrigger,
  submittedInputRawForBalance,
  triggerExecutionEvidence,
  triggerHitPayloadFromEvidence,
  redactExecutionIdentifier,
} from './synthetic-order-execution.js';
export type {
  ClosePositionExecutionEvidence,
  ExecutableTriggerDecision,
  ExecutableTriggerWaitReason,
  TriggerExecutionEvidence,
  TriggerSettlementAmounts,
  TriggerUltraSwapPlan,
  TriggerUltraSwapSide,
} from './synthetic-order-execution.js';

// ── Jupiter Ultra helpers ───────────────────────────────────────────────
export { getUltraOrderProblem } from './jupiter-ultra.js';
export type {
  JupiterUltraOrderLike,
  UltraOrderProblem,
  UltraOrderProblemCode,
} from './jupiter-ultra.js';

// ── Delegated Execution readiness ──────────────────────────────────────
export {
  DELEGATED_EXECUTION_AUTHORIZATION_PRIVATE_KEY_ENV,
  DELEGATED_EXECUTION_AUTHORIZATION_SIGNER_ID_ENVS,
  delegatedExecutionReadinessStatus,
  getDelegatedExecutionAuthorizationSignerId,
} from './delegated-execution-readiness.js';
export type {
  DelegatedExecutionReadinessBlocker,
  DelegatedExecutionReadinessStatus,
  DelegatedExecutionResolvedWallet,
} from './delegated-execution-readiness.js';
