import { type NextRequest } from 'next/server';
import { forwardToWsServer } from '@/lib/cron/forward';

/**
 * Vercel Cron target. Forwards to ws-server's `/cron/track-orders`,
 * which polls Jupiter Trigger History and reconciles fills / expiries
 * into our DB (writing Trade rows + emitting `trade:filled`).
 *
 * The ws-server also has its own in-process scheduler that runs the
 * tracker every 30s when DEMO_MODE is off; the Vercel cron exists so
 * the system stays current even when the long-lived ws host is being
 * redeployed or running on a serverless adapter where setInterval is
 * killed between requests.
 */
export async function GET(req: NextRequest) {
  return forwardToWsServer(req, { path: '/cron/track-orders' });
}
export async function POST(req: NextRequest) {
  return GET(req);
}
