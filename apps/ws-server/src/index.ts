import { createServer } from 'node:http';
import cors from 'cors';
import express, { type Request, type Response } from 'express';
import { Server as IoServer } from 'socket.io';
import {
  ApprovalDecisionPayloadSchema,
  AuthPayloadSchema,
  BARE_TICKERS,
  CronGenerateRequestSchema,
  WsClientEvents,
  type BareTicker,
} from '@hunch-it/shared';
import { env } from './env.js';
import { getPrisma, persistApprovalDecision, shutdownPrisma } from './db/index.js';
import { runOrderTracker } from './orders/tracker/index.js';
import { evaluatePendingSignals } from './signals/evaluator.js';
import { emitSignal, startSignalLoop } from './signals/generator.js';
import { verifyPrivyToken } from './privy/index.js';

const app = express();
app.use(cors({ origin: env.NEXT_PUBLIC_APP_URL, credentials: true }));
app.use(express.json({ limit: '256kb' }));

app.get('/healthz', (_req: Request, res: Response) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// Vercel Cron hits this endpoint with the shared secret in the `Authorization`
// header. It generates one signal on demand and pushes it to connected tabs.
app.post('/cron/generate', async (req: Request, res: Response) => {
  const auth = req.header('authorization') ?? '';
  const expected = `Bearer ${env.WS_CRON_SECRET}`;
  if (auth !== expected) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const parsed = CronGenerateRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid body', issues: parsed.error.flatten() });
  }

  // Accept bare tickers (AAPL) or xStock symbols (AAPLx).
  const raw = parsed.data.ticker;
  let requested: BareTicker | undefined;
  if (raw) {
    const bare = raw.endsWith('x') ? raw.slice(0, -1) : raw;
    if (!BARE_TICKERS.includes(bare as BareTicker)) {
      return res.status(400).json({ error: `unknown ticker: ${raw}` });
    }
    requested = bare as BareTicker;
  }

  const signal = await emitSignal(io, requested);
  if (!signal) return res.status(502).json({ error: 'signal generation failed' });
  return res.json({ ok: true, signal });
});

// Vercel Cron also hits this every 5 minutes. Idempotent: only updates rows
// where evaluatedAt IS NULL.
app.post('/cron/evaluate', async (req: Request, res: Response) => {
  const auth = req.header('authorization') ?? '';
  if (auth !== `Bearer ${env.WS_CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const p = getPrisma();
  if (!p) return res.status(503).json({ error: 'DATABASE_URL not configured' });
  try {
    const summary = await evaluatePendingSignals(p);
    return res.json({ ok: true, ...summary });
  } catch (err) {
    console.warn('[eval] cron run failed', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Vercel Cron also hits this every 30s (Vercel min granularity is 1m so it's
// realistically driven by the in-process setInterval below). Reconciles
// Jupiter Trigger Order state into our DB.
app.post('/cron/track-orders', async (req: Request, res: Response) => {
  const auth = req.header('authorization') ?? '';
  if (auth !== `Bearer ${env.WS_CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const p = getPrisma();
  if (!p) return res.status(503).json({ error: 'DATABASE_URL not configured' });
  try {
    const summary = await runOrderTracker(p, io);
    return res.json({ ok: true, ...summary });
  } catch (err) {
    console.warn('[tracker] cron run failed', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

const httpServer = createServer(app);
const io = new IoServer(httpServer, {
  cors: { origin: env.NEXT_PUBLIC_APP_URL, credentials: true },
});

io.on('connection', (socket) => {
  console.log(`[ws] connected: ${socket.id}`);

  // v1.3: client sends `auth` after connect. Live mode supplies a Privy
  // access token; we verify it server-side, look up the user's walletAddress
  // in our DB, and join the per-user room. Demo mode falls back to a
  // walletAddress hint (e.g. `demo-user`) so the zero-cred UX path keeps
  // working without Privy creds.
  socket.on(WsClientEvents.Auth, async (payload: unknown) => {
    const parsed = AuthPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      console.warn('[ws] bad auth payload', parsed.error.flatten());
      socket.emit('auth:error', { reason: 'invalid payload' });
      return;
    }

    let walletAddress: string | null = null;

    if (env.DEMO_MODE) {
      walletAddress = parsed.data.walletAddress ?? 'demo-user';
    } else if (parsed.data.privyAccessToken) {
      const privyUserId = await verifyPrivyToken(parsed.data.privyAccessToken);
      if (!privyUserId) {
        socket.emit('auth:error', { reason: 'invalid token' });
        return;
      }
      const prisma = getPrisma();
      if (!prisma) {
        socket.emit('auth:error', { reason: 'database unavailable' });
        return;
      }
      const user = await prisma.user.findUnique({ where: { privyUserId } });
      if (!user) {
        socket.emit('auth:error', { reason: 'user not found' });
        return;
      }
      walletAddress = user.walletAddress;
    } else {
      socket.emit('auth:error', { reason: 'token required' });
      return;
    }

    const room = `user:${walletAddress}`;
    void socket.join(room);
    console.log(`[ws] ${socket.id} joined ${room}`);
    socket.emit('auth:ok', { room });
  });

  // Legacy v1.2 — superseded by Skip table writes from /api/skips, but kept
  // wired so older clients don't break.
  socket.on(WsClientEvents.ApprovalDecision, async (payload: unknown) => {
    const parsed = ApprovalDecisionPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      console.warn('[ws] bad approval payload', parsed.error.flatten());
      return;
    }
    await persistApprovalDecision(parsed.data);
    console.log(
      `[ws] approval ${parsed.data.decision ? 'YES' : 'NO '} signal=${parsed.data.signalId} wallet=${parsed.data.walletAddress.slice(0, 6)}…`,
    );
  });

  socket.on(WsClientEvents.Ping, () => socket.emit('pong', Date.now()));

  socket.on('disconnect', (reason) => {
    console.log(`[ws] disconnected ${socket.id}: ${reason}`);
  });
});

const stopFakeLoop = startSignalLoop(io);
const stopEvalLoop = startEvaluatorLoop();
const stopTrackerLoop = startOrderTrackerLoop();

function startEvaluatorLoop(): () => void {
  if (env.DEMO_MODE) {
    console.log('[eval] demo mode — back-evaluator disabled');
    return () => {};
  }
  const intervalMs = 5 * 60_000;
  let stopped = false;
  let busy = false;

  async function tick() {
    if (busy || stopped) return;
    const p = getPrisma();
    if (!p) return; // DATABASE_URL not configured — silently skip
    busy = true;
    try {
      const summary = await evaluatePendingSignals(p);
      if (summary.evaluated > 0 || summary.errors > 0) {
        console.log(
          `[eval] evaluated=${summary.evaluated} skipped=${summary.skipped} errors=${summary.errors}`,
        );
      }
    } catch (err) {
      console.warn('[eval] tick failed', err);
    } finally {
      busy = false;
    }
  }

  // First run 30s after boot so signals from a previous process get caught up.
  const kickoff = setTimeout(() => void tick(), 30_000);
  const handle = setInterval(() => void tick(), intervalMs);
  console.log(`[eval] back-evaluator running every ${intervalMs / 60_000} min`);

  return () => {
    stopped = true;
    clearTimeout(kickoff);
    clearInterval(handle);
  };
}

function startOrderTrackerLoop(): () => void {
  if (env.DEMO_MODE) {
    console.log('[tracker] demo mode — order tracker disabled');
    return () => {};
  }
  const intervalMs = 30_000;
  let stopped = false;
  let busy = false;

  async function tick() {
    if (busy || stopped) return;
    const p = getPrisma();
    if (!p) return;
    busy = true;
    try {
      const s = await runOrderTracker(p, io);
      if (s.fills > 0 || s.expirations > 0 || s.errors > 0) {
        console.log(
          `[tracker] wallets=${s.polledWallets} orders=${s.ordersChecked} fills=${s.fills} expirations=${s.expirations} errors=${s.errors}`,
        );
      }
    } catch (err) {
      console.warn('[tracker] tick failed', err);
    } finally {
      busy = false;
    }
  }

  const kickoff = setTimeout(() => void tick(), 15_000);
  const handle = setInterval(() => void tick(), intervalMs);
  console.log(`[tracker] order tracker running every ${intervalMs / 1000}s`);

  return () => {
    stopped = true;
    clearTimeout(kickoff);
    clearInterval(handle);
  };
}

httpServer.listen(env.WS_SERVER_PORT, () => {
  console.log(`[http] hunch-it ws-server listening on :${env.WS_SERVER_PORT}`);
});

function shutdown(signal: string): void {
  console.log(`[ws] received ${signal}, shutting down`);
  stopFakeLoop();
  stopEvalLoop();
  stopTrackerLoop();
  io.close();
  void shutdownPrisma();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
