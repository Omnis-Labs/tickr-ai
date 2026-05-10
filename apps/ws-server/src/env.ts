import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  WS_SERVER_PORT: z.coerce.number().int().positive().default(4000),
  GEMINI_API_KEY: z.string().optional(),
  ENABLE_DEV_TOOLS: z
    .union([z.literal('true'), z.literal('false')])
    .transform((v) => v === 'true')
    .default('false'),
  DEV_TOOLS_PASSWORD: z.string().default('<choose-a-local-password>'),
  PRIVY_APP_ID: z.string().optional(),
  PRIVY_APP_SECRET: z.string().optional(),
  PYTH_HERMES_URL: z.string().url().default('https://hermes.pyth.network'),
  PYTH_BENCHMARKS_URL: z.string().url().default('https://benchmarks.pyth.network'),
  DATABASE_URL: z.string().optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  NEXT_PUBLIC_SOLANA_RPC_URLS: z.string().optional(),
  SIGNAL_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
  TICKER_STAGGER_SECONDS: z.coerce.number().int().nonnegative().default(2),
  BASE_ANALYSIS_BAR_CLOSE_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(5 * 60),
  BASE_ANALYSIS_MATERIAL_MOVE_PCT: z.coerce.number().positive().default(0.3),
  BASE_ANALYSIS_FORCE_REFRESH_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60),
  LLM_DAILY_USD_CAP: z.coerce.number().positive().default(10),
  LLM_ENABLED: z
    .union([z.literal('true'), z.literal('false')])
    .transform((v) => v === 'true')
    .default('true'),
  ENABLE_BACK_EVAL: z
    .union([z.literal('true'), z.literal('false')])
    .transform((v) => v === 'true')
    .default('false'),
  ENABLE_THESIS_MONITOR: z
    .union([z.literal('true'), z.literal('false')])
    .transform((v) => v === 'true')
    .default('false'),
  ENABLE_SIGNAL_LOOP: z
    .union([z.literal('true'), z.literal('false')])
    .transform((v) => v === 'true')
    .default('false'),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('[env] invalid config:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

export function devToolsEnabled(): boolean {
  return env.ENABLE_DEV_TOOLS;
}
