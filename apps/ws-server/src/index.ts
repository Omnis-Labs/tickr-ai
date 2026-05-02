import { createServer } from 'node:http';
import cors from 'cors';
import express, { type Request, type Response } from 'express';
import { Server as IoServer } from 'socket.io';
import {
  ApprovalDecisionPayloadSchema,
  AuthPayloadSchema,
  WsClientEvents,
} from '@hunch-it/shared';
import { env } from './env.js';
import { getPrisma, persistApprovalDecision, shutdownPrisma } from './db/index.js';
import { runOrderTracker } from './orders/tracker/index.js';
import { runTriggerMonitor } from './orders/trigger-monitor.js';
import { evaluatePendingSignals } from './signals/evaluator.js';
import { emitSignal, startSignalLoop } from './signals/generator.js';
import { runThesisMonitor } from './signals/thesis-monitor.js';
import { verifyPrivyToken } from './privy/index.js';
import { TaskGroup, registerTask } from './scheduler.js';

const app = express();
app.use(cors({ origin: env.NEXT_PUBLIC_APP_URL, credentials: true }));
app.use(express.json({ limit: '256kb' }));

app.get('/healthz', (_req: Request, res: Response) => {
  res.json({ ok: true, uptime: process.uptime() });
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

// Recurring tasks are registered through scheduler.ts: one helper enforces
// busy-skipping, kickoff delay, error swallowing, and shutdown teardown so
// each task body stays just its core logic.
const tasks = new TaskGroup();

const stopFakeLoop = startSignalLoop(io);

tasks.add(
  registerTask({
    name: 'eval',
    intervalMs: 5 * 60_000,
    kickoffMs: 30_000,
    enabled: !env.DEMO_MODE,
    handler: async () => {
      const p = getPrisma();
      if (!p) return;
      const s = await evaluatePendingSignals(p);
      if (s.evaluated > 0 || s.errors > 0) {
        console.log(
          `[eval] evaluated=${s.evaluated} skipped=${s.skipped} errors=${s.errors}`,
        );
      }
    },
  }),
);

tasks.add(
  registerTask({
    name: 'tracker',
    intervalMs: 30_000,
    kickoffMs: 15_000,
    enabled: !env.DEMO_MODE,
    handler: async () => {
      const p = getPrisma();
      if (!p) return;
      const s = await runOrderTracker(p, io);
      if (s.fills > 0 || s.expirations > 0 || s.cancellations > 0 || s.errors > 0) {
        console.log(
          `[tracker] users=${s.polledUsers} orders=${s.ordersChecked} fills=${s.fills} expirations=${s.expirations} cancellations=${s.cancellations} skipped(no-jwt)=${s.skippedNoJwt} errors=${s.errors}`,
        );
      }
    },
  }),
);

// Synthetic-order price monitor — same cadence as the Jupiter tracker
// but for orders we own (xStocks via Ultra) rather than orders Jupiter
// owns. Phase 2 of the Trigger v2 → Ultra pivot.
tasks.add(
  registerTask({
    name: 'trigger-monitor',
    intervalMs: 30_000,
    kickoffMs: 20_000,
    enabled: !env.DEMO_MODE,
    handler: async () => {
      const p = getPrisma();
      if (!p) return;
      const s = await runTriggerMonitor(p, io);
      if (s.hits > 0) {
        console.log(
          `[trigger-monitor] orders=${s.polledOrders} tickers=${s.uniqueTickers} hits=${s.hits}`,
        );
      }
    },
  }),
);

tasks.add(
  registerTask({
    name: 'thesis',
    intervalMs: 5 * 60_000,
    kickoffMs: 60_000,
    enabled: !env.DEMO_MODE,
    handler: async () => {
      const p = getPrisma();
      if (!p) return;
      const s = await runThesisMonitor(p, io);
      if (s.sellsEmitted > 0 || s.errors > 0) {
        console.log(
          `[thesis] positions=${s.positionsChecked} sells=${s.sellsEmitted} errors=${s.errors}`,
        );
      }
    },
  }),
);

httpServer.listen(env.WS_SERVER_PORT, () => {
  console.log(`[http] hunch-it ws-server listening on :${env.WS_SERVER_PORT}`);
});

function shutdown(signal: string): void {
  console.log(`[ws] received ${signal}, shutting down`);
  stopFakeLoop();
  tasks.stopAll();
  io.close();
  void shutdownPrisma();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
