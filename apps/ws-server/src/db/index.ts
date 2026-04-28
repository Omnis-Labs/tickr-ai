// Wraps the shared Prisma client from @hunch-it/db. The legacy v1.2 helpers
// (persistSignal / persistApprovalDecision) are no-ops kept for the
// Socket.IO ApprovalDecision handler.

import { prisma, shutdownPrisma } from '@hunch-it/db';
import type { Signal } from '@hunch-it/shared';
import { env } from '../env.js';

export { shutdownPrisma };

/** Returns the shared Prisma client, or null when DATABASE_URL is unset
 *  (callers in cron loops use this to silently skip ticks in dev). */
export function getPrisma(): typeof prisma | null {
  if (!env.DATABASE_URL) return null;
  return prisma;
}

/** v1.3: no-op. Legacy signal table removed; emission still fans out via Socket.IO. */
export async function persistSignal(signal: Signal): Promise<void> {
  void signal;
}

/** v1.3: no-op. Approvals replaced by Skip / Trade flow (Phase B). */
export async function persistApprovalDecision(input: {
  walletAddress: string;
  signalId: string;
  decision: boolean;
}): Promise<void> {
  void input;
}
