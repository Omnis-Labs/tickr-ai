import { z } from 'zod';

// ────────────────────────────────────────────────────────────────────────
// v1.3 — Mandate / Proposal / Skip / Position / Order / Trade
// ────────────────────────────────────────────────────────────────────────

export const HoldingPeriodSchema = z.enum([
  '1-3 days',
  '1-2 weeks',
  '1-3 months',
  '6+ months',
]);
export type HoldingPeriod = z.infer<typeof HoldingPeriodSchema>;

export const MarketFocusVerticalSchema = z.enum([
  'no_preference',
  'technology_software',
  'semiconductors',
  'ev_clean_energy',
  'financials_fintech',
  'healthcare_pharma',
  'consumer_retail',
  'energy_utilities',
  'crypto_mining',
  'industrials',
  'tokenized_etfs',
  'bluechip_crypto',
]);
export type MarketFocusVertical = z.infer<typeof MarketFocusVerticalSchema>;

export const MandateInputSchema = z.object({
  holdingPeriod: HoldingPeriodSchema,
  maxDrawdown: z.number().min(0).max(1).nullable(), // 0.03 / 0.05 / 0.08 / null
  maxTradeSize: z.number().positive(),
  marketFocus: z.array(MarketFocusVerticalSchema).min(1),
});
export type MandateInput = z.infer<typeof MandateInputSchema>;

export const MandateSchema = MandateInputSchema.extend({
  id: z.string(),
  userId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Mandate = z.infer<typeof MandateSchema>;

export const ProposalActionSchema = z.enum(['BUY']);
export type ProposalAction = z.infer<typeof ProposalActionSchema>;

export const ProposalStatusSchema = z.enum(['ACTIVE', 'EXPIRED', 'SKIPPED', 'EXECUTED']);
export type ProposalStatus = z.infer<typeof ProposalStatusSchema>;

export const ProposalOutcomeSchema = z.enum(['WIN', 'LOSS', 'NEUTRAL']);
export type ProposalOutcome = z.infer<typeof ProposalOutcomeSchema>;

export const SkipReasonSchema = z.enum([
  'TOO_RISKY',
  'DISAGREE_THESIS',
  'BAD_TIMING',
  'ENOUGH_EXPOSURE',
  'PRICE_NOT_ATTRACTIVE',
  'TOO_MANY_PROPOSALS',
  'OTHER',
]);
export type SkipReason = z.infer<typeof SkipReasonSchema>;

export const PositionStateSchema = z.enum([
  'BUY_PENDING',
  'ENTERING',
  'ACTIVE',
  'CLOSING',
  'CLOSED',
]);
export type PositionState = z.infer<typeof PositionStateSchema>;

export const OrderKindSchema = z.enum([
  'BUY_TRIGGER',
  'TAKE_PROFIT',
  'STOP_LOSS',
  'CLOSE_SWAP',
]);
export type OrderKind = z.infer<typeof OrderKindSchema>;

export const OrderStatusSchema = z.enum([
  'PENDING',
  'OPEN',
  'FILLED',
  'PARTIALLY_FILLED',
  'CANCELLED',
  'EXPIRED',
  'FAILED',
]);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const TradeSourceSchema = z.enum(['BUY_APPROVAL', 'TP_FILL', 'SL_FILL', 'USER_CLOSE']);
export type TradeSource = z.infer<typeof TradeSourceSchema>;

export const ProposalReasoningSchema = z.object({
  what_changed: z.string(),
  why_this_trade: z.string(),
  why_fits_mandate: z.string(),
});
export type ProposalReasoning = z.infer<typeof ProposalReasoningSchema>;

export const PositionImpactSchema = z.object({
  weight_before: z.number(),
  weight_after: z.number(),
  cash_after: z.number(),
  sector_before: z.number(),
  sector_after: z.number(),
});
export type PositionImpact = z.infer<typeof PositionImpactSchema>;

export const ProposalSchema = z.object({
  id: z.string(),
  userId: z.string(),
  ticker: z.string(),
  action: ProposalActionSchema,
  suggestedSizeUsd: z.number(),
  suggestedTriggerPrice: z.number(),
  suggestedTakeProfitPrice: z.number(),
  suggestedStopLossPrice: z.number(),
  rationale: z.string(),
  reasoning: ProposalReasoningSchema,
  positionImpact: PositionImpactSchema,
  confidence: z.number().min(0).max(1),
  priceAtProposal: z.number(),
  indicators: z.unknown(),
  status: ProposalStatusSchema,
  expiresAt: z.string(),
  createdAt: z.string(),
});
export type Proposal = z.infer<typeof ProposalSchema>;

export const SkipInputSchema = z.object({
  proposalId: z.string(),
  reason: SkipReasonSchema,
  detail: z.string().optional(),
});
export type SkipInput = z.infer<typeof SkipInputSchema>;

// ────────────────────────────────────────────────────────────────────────
// Legacy (v1.2) shapes — still emitted by the demo signal loop and the
// existing SignalModal until Proposal Generator + ProposalModal land.
// ────────────────────────────────────────────────────────────────────────

export const SignalActionSchema = z.enum(['BUY', 'SELL', 'HOLD']);
export type SignalAction = z.infer<typeof SignalActionSchema>;

export const PriceSnapshotSchema = z.object({
  ticker: z.string(),
  price: z.number(),
  confidence: z.number(),
  publishTime: z.number(), // unix seconds
});
export type PriceSnapshot = z.infer<typeof PriceSnapshotSchema>;

export const BarSchema = z.object({
  time: z.number(), // unix seconds
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
});
export type Bar = z.infer<typeof BarSchema>;

export const IndicatorSnapshotSchema = z.object({
  rsi: z.number().nullable(),
  macd: z
    .object({
      macd: z.number(),
      signal: z.number(),
      histogram: z.number(),
    })
    .nullable(),
  ma20: z.number().nullable(),
  ma50: z.number().nullable(),
});
export type IndicatorSnapshot = z.infer<typeof IndicatorSnapshotSchema>;

export const SignalSchema = z.object({
  id: z.string(),
  ticker: z.string(),
  action: SignalActionSchema,
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  ttlSeconds: z.number().int().positive(),
  priceAtSignal: z.number(),
  indicators: IndicatorSnapshotSchema,
  createdAt: z.string(),
  expiresAt: z.string(),
  degraded: z.boolean().optional(), // true if produced by rule fallback (no LLM)
});
export type Signal = z.infer<typeof SignalSchema>;

export const LlmSignalOutputSchema = z.object({
  action: SignalActionSchema,
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(400),
  ttl_seconds: z.number().int().min(30).max(120),
});
export type LlmSignalOutput = z.infer<typeof LlmSignalOutputSchema>;

export const ApprovalSchema = z.object({
  id: z.string(),
  userId: z.string(),
  signalId: z.string(),
  decision: z.boolean(),
  decidedAt: z.string(),
});
export type Approval = z.infer<typeof ApprovalSchema>;

export const TradeStatusSchema = z.enum(['PENDING', 'CONFIRMED', 'FAILED']);
export type TradeStatus = z.infer<typeof TradeStatusSchema>;

export const TradeSchema = z.object({
  id: z.string(),
  userId: z.string(),
  signalId: z.string().nullable(),
  ticker: z.string(),
  side: z.enum(['BUY', 'SELL']),
  amountUsd: z.number(),
  tokenAmount: z.number(),
  executionPrice: z.number(),
  txSignature: z.string(),
  status: TradeStatusSchema,
  createdAt: z.string(),
});
export type Trade = z.infer<typeof TradeSchema>;

export const PositionSchema = z.object({
  id: z.string(),
  userId: z.string(),
  ticker: z.string(),
  tokenAmount: z.number(),
  avgCost: z.number(),
  updatedAt: z.string(),
});
export type Position = z.infer<typeof PositionSchema>;

// Socket.IO wire events
export const WsServerEvents = {
  SignalNew: 'signal:new',
  SignalExpired: 'signal:expired',
} as const;

export const WsClientEvents = {
  ApprovalDecision: 'approval:decision',
  Ping: 'ping',
} as const;

export const ApprovalDecisionPayloadSchema = z.object({
  signalId: z.string(),
  walletAddress: z.string(),
  decision: z.boolean(),
});
export type ApprovalDecisionPayload = z.infer<typeof ApprovalDecisionPayloadSchema>;

export const CronGenerateRequestSchema = z.object({
  ticker: z.string().optional(),
});
export type CronGenerateRequest = z.infer<typeof CronGenerateRequestSchema>;
