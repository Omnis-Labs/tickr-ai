import { type NextRequest } from 'next/server';
import { forwardToWsServer } from '@/lib/cron/forward';

/**
 * Vercel Cron target — generates one signal and broadcasts it via the
 * ws-server's Socket.IO. Optional `?ticker=AAPL` query forces a specific
 * symbol; otherwise the generator picks one off its rotation.
 */
export async function GET(req: NextRequest) {
  const ticker = new URL(req.url).searchParams.get('ticker') ?? undefined;
  return forwardToWsServer(req, {
    path: '/cron/generate',
    body: ticker ? { ticker } : {},
  });
}
export async function POST(req: NextRequest) {
  return GET(req);
}
