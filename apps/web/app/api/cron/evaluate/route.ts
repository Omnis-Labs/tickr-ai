import { type NextRequest } from 'next/server';
import { forwardToWsServer } from '@/lib/cron/forward';

/**
 * Vercel Cron target. Forwards to ws-server's `/cron/evaluate`, which
 * scans matured signals (>1h old, not yet evaluated) and writes their
 * outcome.
 */
export async function GET(req: NextRequest) {
  return forwardToWsServer(req, { path: '/cron/evaluate' });
}
export async function POST(req: NextRequest) {
  return GET(req);
}
