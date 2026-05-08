import 'server-only';

import { GoogleGenAI, type GenerateContentResponse } from '@google/genai';
import { z } from 'zod';
import { createBuyProposalForUser } from '@hunch-it/db';
import {
  MIN_ACTIONABLE_CONFIDENCE,
  PYTH_BENCHMARKS_BASE,
  buildBaseMarketAnalysis,
  evaluateSignalDataFreshness,
  requireAsset,
  type Bar,
  type TriggerHitPayload,
} from '@hunch-it/shared';
import { expireActiveProposals, prisma } from '@/lib/db';
import { decimalsToNumbers } from '@/lib/db/decimal';
import { getCurrentPriceSnapshots, getCurrentPrices } from '@/lib/pyth';
import { readUsdcBalance } from '@/lib/solana/usdc-balance';
import { devToolsPassword } from './auth';

export const GEMINI_DEV_TOOLS_MODEL = 'gemini-3.1-flash-lite-preview';

export class ActiveDevToolsProposalError extends Error {
  constructor(public proposalId: string) {
    super('active_dev_tools_proposal_exists');
    this.name = 'ActiveDevToolsProposalError';
  }
}

export interface DevToolsProposalResult {
  proposal: unknown;
  telemetry: {
    model: string;
    degraded: boolean;
    latestPrice: number;
    priceAgeSeconds: number;
    barsFetched: number;
    inputTokens: number;
    outputTokens: number;
  };
}

export interface DevToolsOrderRow {
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

const BENCHMARKS = process.env.PYTH_BENCHMARKS_URL ?? PYTH_BENCHMARKS_BASE;
const MIN_SUGGESTED_SIZE_USD = 5;
const ROUND_INCREMENT_USD = 5;

const GeminiProposalSchema = z.object({
  confidence: z.number().min(0).max(1).optional(),
  rationale: z.string().max(700).optional(),
  what_changed: z.string().max(700).optional(),
  why_this_trade: z.string().max(700).optional(),
  trigger_price: z.number().positive().optional(),
  take_profit_price: z.number().positive().optional(),
  stop_loss_price: z.number().positive().optional(),
  suggested_size_usd: z.number().positive().optional(),
});

type IndicatorSet = {
  rsi: number;
  macd: { macd: number; signal: number; histogram: number };
  ma20: number;
  ma50: number;
};

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function finitePositive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function defaultProposalSizeUsd(input: { availableUsdc: number; maxTradeSizeUsd: number }): number {
  const availableUsdc = finitePositive(input.availableUsdc);
  const maxTradeSizeUsd = finitePositive(input.maxTradeSizeUsd);
  if (availableUsdc === 0 || maxTradeSizeUsd === 0) return 0;

  const rawTarget = availableUsdc * 0.2;
  const balanceSized =
    rawTarget < MIN_SUGGESTED_SIZE_USD
      ? Math.min(availableUsdc, MIN_SUGGESTED_SIZE_USD)
      : Math.ceil(rawTarget / ROUND_INCREMENT_USD) * ROUND_INCREMENT_USD;

  return Number(Math.min(balanceSized, availableUsdc, maxTradeSizeUsd).toFixed(2));
}

function ema(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [values[0] ?? 0];
  for (let i = 1; i < values.length; i++) {
    out.push((values[i] ?? 0) * k + (out[i - 1] ?? 0) * (1 - k));
  }
  return out;
}

function sma(values: number[], period: number): number {
  const slice = values.slice(-period);
  if (slice.length === 0) return 0;
  return slice.reduce((acc, v) => acc + v, 0) / slice.length;
}

function rsi(values: number[], period = 14): number {
  if (values.length < 2) return 50;
  const start = Math.max(1, values.length - period);
  let gains = 0;
  let losses = 0;
  for (let i = start; i < values.length; i++) {
    const delta = (values[i] ?? 0) - (values[i - 1] ?? 0);
    if (delta >= 0) gains += delta;
    else losses += Math.abs(delta);
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

function computeIndicators(bars: Bar[], latestPrice: number): IndicatorSet {
  const closes = bars.map((b) => b.close).filter((v) => Number.isFinite(v) && v > 0);
  if (closes.length === 0) closes.push(latestPrice);
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdSeries = closes.map((_, i) => (ema12[i] ?? 0) - (ema26[i] ?? 0));
  const signalSeries = ema(macdSeries, 9);
  const macd = macdSeries.at(-1) ?? 0;
  const signal = signalSeries.at(-1) ?? 0;
  return {
    rsi: Number(rsi(closes).toFixed(2)),
    macd: {
      macd: Number(macd.toFixed(4)),
      signal: Number(signal.toFixed(4)),
      histogram: Number((macd - signal).toFixed(4)),
    },
    ma20: Number(sma(closes, 20).toFixed(2)),
    ma50: Number(sma(closes, 50).toFixed(2)),
  };
}

function downsample<T>(arr: T[], target: number): T[] {
  if (arr.length <= target) return arr;
  const step = Math.ceil(arr.length / target);
  const out: T[] = [];
  for (let i = 0; i < arr.length; i += step) out.push(arr[i] as T);
  const last = arr.at(-1);
  if (last && out.at(-1) !== last) out.push(last);
  return out;
}

function formatBars(bars: Bar[]): string {
  return downsample(bars, 48)
    .map((b) => {
      const d = new Date(b.time * 1000);
      const hh = String(d.getUTCHours()).padStart(2, '0');
      const mm = String(d.getUTCMinutes()).padStart(2, '0');
      return `${hh}:${mm} O:${b.open.toFixed(2)} H:${b.high.toFixed(2)} L:${b.low.toFixed(2)} C:${b.close.toFixed(2)}`;
    })
    .join('\n');
}

function pythSymbol(assetId: string): string {
  const asset = requireAsset(assetId);
  if (!asset.pythSymbol) throw new Error(`${assetId} has no Pyth symbol configured`);
  return asset.pythSymbol;
}

async function fetchBars(assetId: string): Promise<Bar[]> {
  const to = Math.floor(Date.now() / 1000);
  const from = to - 24 * 60 * 60;
  const url =
    `${BENCHMARKS}/v1/shims/tradingview/history` +
    `?symbol=${encodeURIComponent(pythSymbol(assetId))}` +
    `&resolution=5&from=${from}&to=${to}`;

  const res = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' });
  if (!res.ok) throw new Error(`Pyth benchmarks failed: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as {
    s: 'ok' | 'no_data' | 'error';
    t?: number[];
    o?: number[];
    h?: number[];
    l?: number[];
    c?: number[];
    errmsg?: string;
  };
  if (json.s === 'no_data' || !json.t) return [];
  if (json.s !== 'ok' || !json.o || !json.h || !json.l || !json.c) {
    throw new Error(`Pyth benchmarks: ${json.errmsg ?? json.s}`);
  }
  return json.t.map((time, i) => ({
    time,
    open: json.o![i] ?? 0,
    high: json.h![i] ?? 0,
    low: json.l![i] ?? 0,
    close: json.c![i] ?? 0,
  }));
}

function buildGeminiPrompt(input: {
  assetId: string;
  latestPrice: number;
  bars: Bar[];
  indicators: IndicatorSet;
  holdingPeriod: string;
  maxDrawdown: number | null;
  maxTradeSize: number;
  availableUsdc: number;
  defaultSizeUsd: number;
}): string {
  const maxDrawdown =
    input.maxDrawdown == null ? 'none' : `${(input.maxDrawdown * 100).toFixed(1)}%`;
  return `You create test BUY proposals for Hunch It's password-gated dev tools.
Use the live Pyth price/bars below, but always return a BUY-shaped JSON object. Keep it realistic and conservative.

Asset: ${input.assetId}
Latest price: $${input.latestPrice.toFixed(2)}
Mandate holding period: ${input.holdingPeriod}
Mandate max drawdown: ${maxDrawdown}
Mandate max trade size: $${input.maxTradeSize.toFixed(2)}
Wallet USDC balance: $${input.availableUsdc.toFixed(2)}
Default proposal size: $${input.defaultSizeUsd.toFixed(2)} (20% of USDC balance, rounded up to the next $5 increment; if below $5, use up to $5)

Indicators:
RSI(14): ${input.indicators.rsi.toFixed(2)}
MACD: ${input.indicators.macd.macd.toFixed(4)}, signal ${input.indicators.macd.signal.toFixed(4)}, histogram ${input.indicators.macd.histogram.toFixed(4)}
MA20: ${input.indicators.ma20.toFixed(2)}
MA50: ${input.indicators.ma50.toFixed(2)}

Recent 5-minute bars, oldest first, UTC:
${formatBars(input.bars)}

Output only JSON matching:
{
  "confidence": number between ${MIN_ACTIONABLE_CONFIDENCE.toFixed(2)} and 0.92,
  "rationale": string,
  "what_changed": string,
  "why_this_trade": string,
  "trigger_price": number,
  "take_profit_price": number,
  "stop_loss_price": number,
  "suggested_size_usd": number
}`;
}

let gemini: GoogleGenAI | null = null;
function geminiClient(): GoogleGenAI | null {
  if (gemini) return gemini;
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  gemini = new GoogleGenAI({ apiKey: key });
  return gemini;
}

async function askGemini(prompt: string): Promise<{
  parsed: z.infer<typeof GeminiProposalSchema> | null;
  inputTokens: number;
  outputTokens: number;
}> {
  const client = geminiClient();
  if (!client) return { parsed: null, inputTokens: 0, outputTokens: 0 };

  let response: GenerateContentResponse;
  try {
    response = await client.models.generateContent({
      model: GEMINI_DEV_TOOLS_MODEL,
      contents: prompt,
      config: { maxOutputTokens: 700, responseMimeType: 'application/json' },
    });
  } catch (err) {
    console.warn('[dev-tools] gemini proposal call failed', err);
    return { parsed: null, inputTokens: 0, outputTokens: 0 };
  }

  const text = response.text ?? '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { parsed: null, inputTokens: 0, outputTokens: 0 };
  try {
    const parsed = GeminiProposalSchema.safeParse(JSON.parse(match[0]));
    return {
      parsed: parsed.success ? parsed.data : null,
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
    };
  } catch {
    return {
      parsed: null,
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
    };
  }
}

export async function createDevToolsProposal(input: {
  userId: string;
  ticker: string;
}): Promise<DevToolsProposalResult> {
  const meta = requireAsset(input.ticker);
  if (!meta?.mint) throw new Error(`${input.ticker} mint not configured`);

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    include: {
      mandate: true,
      positions: {
        where: { ticker: input.ticker, state: { not: 'CLOSED' } },
        select: { id: true },
      },
    },
  });
  if (!user) throw new Error('user not found');
  const mandate = user.mandate;
  if (!mandate) throw new Error('complete mandate before using dev tools');

  const now = new Date();
  await expireActiveProposals(prisma, { userId: input.userId, origin: 'DEV_TOOLS', now });
  const activeProposal = await prisma.proposal.findFirst({
    where: {
      userId: input.userId,
      origin: 'DEV_TOOLS',
      status: 'ACTIVE',
      expiresAt: { gt: now },
    },
    select: { id: true },
    orderBy: { createdAt: 'desc' },
  });
  if (activeProposal) throw new ActiveDevToolsProposalError(activeProposal.id);

  const priceMap = await getCurrentPriceSnapshots([input.ticker]);
  const latestSnap = priceMap.get(input.ticker) ?? null;
  if (!latestSnap) throw new Error(`No Pyth price for ${input.ticker}`);
  const freshness = evaluateSignalDataFreshness(latestSnap);
  if (!freshness.fresh) {
    throw new Error(`Stale Pyth price for ${input.ticker}: ${freshness.reason}`);
  }
  const latestPrice = latestSnap.price;

  const bars = await fetchBars(input.ticker);
  const indicators = computeIndicators(bars, latestPrice);
  const maxTradeSize = mandate.maxTradeSize.toNumber();
  const maxDrawdown = mandate.maxDrawdown?.toNumber() ?? null;
  const availableUsdc = await readUsdcBalance(user.walletAddress, {
    forceFresh: true,
    throwOnFailure: true,
  });
  const defaultSizeUsd = defaultProposalSizeUsd({
    availableUsdc,
    maxTradeSizeUsd: maxTradeSize,
  });
  if (defaultSizeUsd <= 0) {
    throw new Error('No USDC balance available to size a proposal.');
  }

  const prompt = buildGeminiPrompt({
    assetId: input.ticker,
    latestPrice,
    bars,
    indicators,
    holdingPeriod: mandate.holdingPeriod,
    maxDrawdown,
    maxTradeSize,
    availableUsdc,
    defaultSizeUsd,
  });
  const llm = await askGemini(prompt);
  const degraded = !llm.parsed;

  const confidence = Number(
    clamp(llm.parsed?.confidence ?? 0.72, MIN_ACTIONABLE_CONFIDENCE, 0.92).toFixed(2),
  );

  const created = await prisma.$transaction(async (tx) => {
    const createNow = new Date();
    await expireActiveProposals(tx, { userId: input.userId, origin: 'DEV_TOOLS', now: createNow });
    const latestActive = await tx.proposal.findFirst({
      where: {
        userId: input.userId,
        origin: 'DEV_TOOLS',
        status: 'ACTIVE',
        expiresAt: { gt: createNow },
      },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });
    if (latestActive) throw new ActiveDevToolsProposalError(latestActive.id);

    const proposal = await createBuyProposalForUser(tx, {
      userId: user.id,
      analysis: buildBaseMarketAnalysis({
        assetId: input.ticker,
        action: 'BUY',
        confidence,
        rationale:
          llm.parsed?.rationale ??
          `Live Pyth test proposal for ${meta.displaySymbol} at $${latestPrice.toFixed(2)}.`,
        whatChanged:
          llm.parsed?.what_changed ?? 'Dev tools requested a live Pyth/Gemini test proposal.',
        whyThisTrade:
          llm.parsed?.why_this_trade ??
          `Uses current price $${latestPrice.toFixed(2)}, RSI ${indicators.rsi.toFixed(1)}, and MA20 $${indicators.ma20.toFixed(2)}.`,
        priceAtAnalysis: latestPrice,
        suggestedTriggerPrice: llm.parsed?.trigger_price,
        suggestedTakeProfitPrice: llm.parsed?.take_profit_price,
        suggestedStopLossPrice: llm.parsed?.stop_loss_price,
        indicators: {
          rsi: indicators.rsi,
          macd: indicators.macd,
          ma20: indicators.ma20,
          ma50: indicators.ma50,
        },
      }),
      mandate: {
        holdingPeriod: mandate.holdingPeriod,
        maxTradeSizeUsd: maxTradeSize,
        maxDrawdown,
      },
      positionImpact: {
        totalUsd: availableUsdc,
        cashUsd: availableUsdc,
        assetExposureUsd: 0,
        verticalExposureUsd: 0,
      },
      origin: 'DEV_TOOLS',
      now: createNow,
      sizeUsd: defaultSizeUsd,
      sizeRationale:
        `Size $${defaultSizeUsd.toFixed(2)} is based on your $${availableUsdc.toFixed(2)} USDC balance ` +
        `and is within your $${maxTradeSize.toFixed(2)} max trade size.`,
      rationalePrefix: '[DEV_TOOLS] ',
    });
    if (!proposal) throw new Error('dev_tools_proposal_not_actionable');
    return proposal;
  });

  console.log(
    `[dev-tools] proposal created user=${user.walletAddress.slice(0, 6)} asset=${meta.displaySymbol} proposal=${created.id} degraded=${degraded}`,
  );

  return {
    proposal: decimalsToNumbers({
      ...created,
      expiresAt: created.expiresAt.toISOString(),
      createdAt: created.createdAt.toISOString(),
    }),
    telemetry: {
      model: GEMINI_DEV_TOOLS_MODEL,
      degraded,
      latestPrice,
      priceAgeSeconds: freshness.ageSeconds,
      barsFetched: bars.length,
      inputTokens: llm.inputTokens,
      outputTokens: llm.outputTokens,
    },
  };
}

export async function listDevToolsState(userId: string): Promise<{
  proposals: unknown[];
  orders: DevToolsOrderRow[];
  positions: unknown[];
}> {
  await expireActiveProposals(prisma, { userId, origin: 'DEV_TOOLS' });

  const [proposals, positions, orders] = await Promise.all([
    prisma.proposal.findMany({
      where: { userId, origin: 'DEV_TOOLS' },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.position.findMany({
      where: { userId, proposals: { some: { origin: 'DEV_TOOLS' } } },
      include: { proposals: { where: { origin: 'DEV_TOOLS' }, select: { id: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    }),
    prisma.order.findMany({
      where: {
        userId,
        position: { proposals: { some: { origin: 'DEV_TOOLS' } } },
      },
      include: {
        position: {
          include: {
            proposals: {
              where: { origin: 'DEV_TOOLS' },
              select: { id: true },
              take: 1,
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  ]);

  return {
    proposals: decimalsToNumbers(
      proposals.map((p) => ({
        ...p,
        expiresAt: p.expiresAt.toISOString(),
        createdAt: p.createdAt.toISOString(),
      })),
    ),
    positions: decimalsToNumbers(
      positions.map((p) => ({
        ...p,
        firstEntryAt: p.firstEntryAt.toISOString(),
        closedAt: p.closedAt?.toISOString() ?? null,
        updatedAt: p.updatedAt.toISOString(),
      })),
    ),
    orders: decimalsToNumbers(
      orders.map((o) => ({
        id: o.id,
        positionId: o.positionId,
        kind: o.kind,
        side: o.side,
        status: o.status,
        triggerPriceUsd: o.triggerPriceUsd,
        sizeUsd: o.sizeUsd,
        tokenAmount: o.tokenAmount,
        ticker: o.position.ticker,
        mint: o.position.mint,
        positionState: o.position.state,
        proposalId: o.position.proposals[0]?.id ?? null,
        createdAt: o.createdAt.toISOString(),
      })),
    ) as unknown as DevToolsOrderRow[],
  };
}

export async function buildOwnedDevTriggerPayload(input: {
  userId: string;
  orderId: string;
}): Promise<{ payload: TriggerHitPayload; walletAddress: string }> {
  const order = await prisma.order.findFirst({
    where: {
      id: input.orderId,
      userId: input.userId,
      status: 'OPEN',
      triggerPriceUsd: { not: null },
      jupiterOrderId: null,
      kind: { in: ['BUY_TRIGGER', 'TAKE_PROFIT', 'STOP_LOSS'] },
    },
    include: {
      user: true,
      position: {
        include: {
          proposals: {
            where: { origin: 'DEV_TOOLS', userId: input.userId },
            select: { id: true },
            take: 1,
          },
        },
      },
    },
  });
  if (!order) throw new Error('open owned order not found');
  if (order.position.proposals.length === 0) {
    throw new Error('order is not linked to a DEV_TOOLS proposal');
  }
  const trigger = order.triggerPriceUsd?.toNumber();
  if (!trigger) throw new Error('order has no trigger price');

  const currentPriceMap = await getCurrentPrices([order.position.ticker]);
  const currentPriceUsd = currentPriceMap.get(order.position.ticker) ?? trigger;

  return {
    walletAddress: order.user.walletAddress,
    payload: {
      orderId: order.id,
      positionId: order.positionId,
      ticker: order.position.ticker,
      mint: order.position.mint,
      kind: order.kind,
      side: order.side === 'BUY' ? 'BUY' : 'SELL',
      triggerPriceUsd: trigger,
      currentPriceUsd,
      sizeUsd: order.sizeUsd.toNumber(),
      tokenAmount: order.tokenAmount?.toNumber() ?? null,
    },
  };
}

export async function emitDevTrigger(input: {
  walletAddress: string;
  payload: TriggerHitPayload;
}): Promise<{ ok: true; emitted: TriggerHitPayload }> {
  const base =
    process.env.WS_SERVER_INTERNAL_URL ??
    process.env.WS_URL_INTERNAL ??
    process.env.NEXT_PUBLIC_WS_URL ??
    'http://localhost:4000';
  const res = await fetch(`${base.replace(/\/$/, '')}/dev-tools/trigger-hit`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-dev-tools-password': devToolsPassword(),
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `ws-server ${res.status}`);
  }
  console.log(
    `[dev-tools] force trigger order=${input.payload.orderId} wallet=${input.walletAddress.slice(0, 6)} kind=${input.payload.kind}`,
  );
  return { ok: true, emitted: input.payload };
}
