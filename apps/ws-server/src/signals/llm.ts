import { GoogleGenAI, type GenerateContentResponse } from '@google/genai';
import { z } from 'zod';
import {
  MIN_ACTIONABLE_CONFIDENCE,
  type Bar,
  type BareTicker,
} from '@hunch-it/shared';
import { env } from '../env.js';
import type { IndicatorResult } from './indicators.js';

export const GEMINI_SIGNAL_MODEL = 'gemini-3.1-flash-lite-preview';

// Keep the cost guard conservative. Gemini preview prices can move, but
// this estimate is good enough for a daily cap and is surfaced in logs.
const GEMINI_INPUT_PER_MTOK = 0.25;
const GEMINI_OUTPUT_PER_MTOK = 1.5;

export const LlmSignalSchema = z.object({
  action: z.enum(['BUY', 'SELL', 'HOLD']),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(400),
  ttl_seconds: z.number().int().min(30).max(120),
});
export type LlmSignal = z.infer<typeof LlmSignalSchema>;

export interface LlmInput {
  ticker: BareTicker;
  currentPrice: number;
  bars: Bar[];
  indicators: IndicatorResult;
}

export interface LlmResult {
  signal: LlmSignal;
  degraded: boolean; // true if produced by rule fallback
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI | null {
  if (client) return client;
  if (!env.GEMINI_API_KEY) return null;
  client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  return client;
}

// ----------------------------------------------------------------------------
// Bar downsampling: keep every Nth bar so the prompt stays under ~4k input tok.
// 288 → 48 means keep every 6th.
// ----------------------------------------------------------------------------
function downsample<T>(arr: T[], target: number): T[] {
  if (arr.length <= target) return arr;
  const step = Math.ceil(arr.length / target);
  const out: T[] = [];
  for (let i = 0; i < arr.length; i += step) out.push(arr[i] as T);
  // Always include the last bar even if step skips it.
  if (out[out.length - 1] !== arr[arr.length - 1]) out.push(arr[arr.length - 1] as T);
  return out;
}

function fmtBar(b: Bar): string {
  const d = new Date(b.time * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm} O:${b.open.toFixed(2)} H:${b.high.toFixed(2)} L:${b.low.toFixed(2)} C:${b.close.toFixed(2)}`;
}

export function buildPrompt(input: LlmInput): string {
  const sampled = downsample(input.bars, 48);
  const { indicators: ind, currentPrice, ticker } = input;
  const pctVsMa20 = ind.ma20 > 0 ? ((currentPrice / ind.ma20 - 1) * 100).toFixed(2) : 'n/a';
  const pctVsMa50 = ind.ma50 > 0 ? ((currentPrice / ind.ma50 - 1) * 100).toFixed(2) : 'n/a';
  return `You are a technical analysis assistant for tokenized US stocks on Solana.
Given the following market data for ${ticker}, output a JSON object with your trading recommendation for the next 1 hour.

Current price: $${currentPrice.toFixed(2)}

Recent price action (downsampled 5-min bars, oldest first, UTC):
${sampled.map(fmtBar).join('\n')}

Indicators (latest):
  RSI(14): ${ind.rsi14.toFixed(2)}
  MACD: ${ind.macd.macd.toFixed(4)}, Signal: ${ind.macd.signal.toFixed(4)}, Hist: ${ind.macd.histogram.toFixed(4)}
  MA20: ${ind.ma20.toFixed(2)}
  MA50: ${ind.ma50.toFixed(2)}
  Price vs MA20: ${pctVsMa20}%
  Price vs MA50: ${pctVsMa50}%

Output ONLY a valid JSON object matching this schema, no markdown, no prose:
{
  "action": "BUY" | "SELL" | "HOLD",
  "confidence": number between 0 and 1,
  "rationale": string (max 200 chars, English, technical reasoning citing specific indicator values),
  "ttl_seconds": integer between 30 and 120
}

Rules:
- Only recommend BUY or SELL if confidence > ${MIN_ACTIONABLE_CONFIDENCE}. Otherwise HOLD.
- BUY when oversold + bullish trend confirmation. SELL when overbought + bearish divergence.
- Mention specific indicator values in rationale.`;
}

// ----------------------------------------------------------------------------
// Rule-based fallback used when LLM is disabled, no API key, or daily cap hit.
// ----------------------------------------------------------------------------
export function ruleBasedSignal(input: LlmInput): LlmSignal {
  const { rsi14, macd, ma20 } = input.indicators;
  const price = input.currentPrice;
  const aboveMa20 = price > ma20;
  if (rsi14 < 30 && macd.histogram > 0 && aboveMa20) {
    return {
      action: 'BUY',
      confidence: 0.72,
      rationale: `Rule: RSI=${rsi14.toFixed(1)} oversold, MACD hist=${macd.histogram.toFixed(3)} bullish, price>MA20.`,
      ttl_seconds: 60,
    };
  }
  if (rsi14 > 70 && macd.histogram < 0 && !aboveMa20) {
    return {
      action: 'SELL',
      confidence: 0.72,
      rationale: `Rule: RSI=${rsi14.toFixed(1)} overbought, MACD hist=${macd.histogram.toFixed(3)} bearish, price<MA20.`,
      ttl_seconds: 60,
    };
  }
  return {
    action: 'HOLD',
    confidence: 0.5,
    rationale: `Rule: RSI=${rsi14.toFixed(1)}, MACD hist=${macd.histogram.toFixed(3)}, no edge.`,
    ttl_seconds: 60,
  };
}

function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens * GEMINI_INPUT_PER_MTOK + outputTokens * GEMINI_OUTPUT_PER_MTOK) /
    1_000_000
  );
}

let spendDate = new Date().toISOString().slice(0, 10);
let spendUsd = 0;

function getLlmSpendUsd(): number {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== spendDate) {
    spendDate = today;
    spendUsd = 0;
  }
  return spendUsd;
}

function recordLlmSpendUsd(deltaUsd: number): number {
  getLlmSpendUsd();
  spendUsd += deltaUsd;
  return spendUsd;
}

export async function generateLlmSignal(input: LlmInput): Promise<LlmResult> {
  const client = getClient();
  if (!client || !env.LLM_ENABLED) {
    return { signal: ruleBasedSignal(input), degraded: true };
  }

  const spend = await getLlmSpendUsd();
  if (spend >= env.LLM_DAILY_USD_CAP) {
    console.warn(
      `[llm] daily cap reached ($${spend.toFixed(2)} >= $${env.LLM_DAILY_USD_CAP}); using rule fallback`,
    );
    return { signal: ruleBasedSignal(input), degraded: true };
  }

  const prompt = buildPrompt(input);
  let response: GenerateContentResponse;
  try {
    response = await client.models.generateContent({
      model: GEMINI_SIGNAL_MODEL,
      contents: prompt,
      config: {
        maxOutputTokens: 400,
        responseMimeType: 'application/json',
      },
    });
  } catch (err) {
    console.warn('[llm] gemini call failed, falling back to rules', err);
    return { signal: ruleBasedSignal(input), degraded: true };
  }

  const text = response.text ?? '';

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn('[llm] no JSON in response:', text.slice(0, 240));
    return { signal: ruleBasedSignal(input), degraded: true };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.warn('[llm] JSON parse failed', err);
    return { signal: ruleBasedSignal(input), degraded: true };
  }
  const validated = LlmSignalSchema.safeParse(parsed);
  if (!validated.success) {
    console.warn('[llm] schema validation failed', validated.error.flatten());
    return { signal: ruleBasedSignal(input), degraded: true };
  }

  const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
  const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
  const costUsd = estimateCostUsd(inputTokens, outputTokens);
  const newSpend = await recordLlmSpendUsd(costUsd);

  console.log(
    `[llm] ${input.ticker} ${validated.data.action} conf=${validated.data.confidence.toFixed(2)} ` +
      `model=${GEMINI_SIGNAL_MODEL} tokens=${inputTokens}/${outputTokens} cost=$${costUsd.toFixed(4)} spend=$${newSpend.toFixed(2)}`,
  );

  return {
    signal: validated.data,
    degraded: false,
    inputTokens,
    outputTokens,
    costUsd,
  };
}
