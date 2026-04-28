// Explicit re-exports work better with Turbopack's cross-workspace resolver
// than `export *` (it sometimes drops named exports during HMR).

// ── v1.3 mandate / proposal / skip / position / order / trade ────────────
export {
  HoldingPeriodSchema,
  MarketFocusVerticalSchema,
  MandateInputSchema,
  MandateSchema,
  ProposalActionSchema,
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
} from './types';
export type {
  HoldingPeriod,
  MarketFocusVertical,
  MandateInput,
  Mandate,
  ProposalAction,
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
} from './types';

// ── legacy v1.2 types still used by demo signal loop ─────────────────────
export {
  ApprovalDecisionPayloadSchema,
  ApprovalSchema,
  AuthPayloadSchema,
  BarSchema,
  CronGenerateRequestSchema,
  IndicatorSnapshotSchema,
  LlmSignalOutputSchema,
  PositionSchema,
  PriceSnapshotSchema,
  SignalActionSchema,
  SignalSchema,
  TradeSchema,
  TradeStatusSchema,
  WsClientEvents,
  WsServerEvents,
} from './types';
export type {
  ApprovalDecisionPayload,
  Approval,
  AuthPayload,
  Bar,
  CronGenerateRequest,
  IndicatorSnapshot,
  LlmSignalOutput,
  Position,
  PriceSnapshot,
  Signal,
  SignalAction,
  Trade,
  TradeStatus,
} from './types';

// ── constants ────────────────────────────────────────────────────────────
export {
  BARE_TICKERS,
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
  bareToXStock,
  requireMint,
  requirePythFeedId,
  solscanTokenUrl,
  xStockToBare,
} from './constants';
export type {
  BareTicker,
  DrawdownOption,
  HoldingPeriodOption,
  MarketFocusVerticalDef,
  XStockMeta,
  XStockTicker,
} from './constants';

// ── RPC helpers ──────────────────────────────────────────────────────────
export { createRpcRoundRobin, parseRpcUrls } from './rpc';

// ── demo fixtures ────────────────────────────────────────────────────────
export {
  DEMO_FAKE_MINT,
  DEMO_LEADERBOARD,
  DEMO_MANDATE,
  demoInitialPositions,
  demoInitialProposals,
  demoInitialTrades,
  makeDemoBars,
  makeDemoProposal,
  makeDemoSignal,
} from './demo';
export type {
  DemoPortfolioPosition,
  DemoPortfolioTrade,
  DemoProposalShape,
} from './demo';
