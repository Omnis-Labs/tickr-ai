import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  WS_SERVER_PORT: z.coerce.number().int().positive().default(4000),
  WS_CRON_SECRET: z.string().min(1).default('change-me-shared-secret'),
  ANTHROPIC_API_KEY: z.string().optional(),
  PRIVY_APP_ID: z.string().optional(),
  PRIVY_APP_SECRET: z.string().optional(),
  PYTH_HERMES_URL: z.string().url().default('https://hermes.pyth.network'),
  PYTH_BENCHMARKS_URL: z.string().url().default('https://benchmarks.pyth.network'),
  DATABASE_URL: z.string().optional(),
  UPSTASH_REDIS_REST_URL: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  NEXT_PUBLIC_SOLANA_RPC_URLS: z.string().optional(),
  SIGNAL_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
  TICKER_STAGGER_SECONDS: z.coerce.number().int().nonnegative().default(2),
  BYPASS_MARKET_HOURS: z
    .union([z.literal('true'), z.literal('false')])
    .transform((v) => v === 'true')
    .default('false'),
  LLM_DAILY_USD_CAP: z.coerce.number().positive().default(10),
  LLM_ENABLED: z
    .union([z.literal('true'), z.literal('false')])
    .transform((v) => v === 'true')
    .default('true'),
  DEMO_MODE: z
    .union([z.literal('true'), z.literal('false')])
    .transform((v) => v === 'true')
    .default('false'),
  DEMO_INTERVAL_SECONDS: z.coerce.number().int().positive().default(20),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('[env] invalid config:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
