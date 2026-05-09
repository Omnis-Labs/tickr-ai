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
  TriggerHitPayloadSchema,
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
  TriggerHitPayload,
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
export {
  SIGNAL_DATA_MAX_AGE_SECONDS,
  evaluateSignalDataFreshness,
} from './signal-data.js';
export type { SignalDataFreshnessVerdict } from './signal-data.js';

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
export {
  THESIS_TAGS,
  evaluateThesis,
  extractThesisTags,
  getThesisTag,
} from './thesis.js';
export type {
  ThesisEvaluation,
  ThesisIndicatorSnapshot,
  ThesisTagDef,
} from './thesis.js';

// ── RPC helpers ──────────────────────────────────────────────────────────
export { createRpcRoundRobin, parseRpcUrls } from './rpc.js';

// ── Synthetic Order execution helpers ───────────────────────────────────
export {
  buildTriggerUltraSwapPlan,
  settlementAmountsForTrigger,
  submittedInputRawForBalance,
} from './synthetic-order-execution.js';
export type {
  TriggerSettlementAmounts,
  TriggerUltraSwapPlan,
  TriggerUltraSwapSide,
} from './synthetic-order-execution.js';
