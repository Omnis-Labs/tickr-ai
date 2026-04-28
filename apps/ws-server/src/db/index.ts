// v1.3 transition: the legacy Signal/Approval tables are gone. The
// ws-server signal-emit loop still broadcasts via Socket.IO so demo mode
// keeps working, but DB writes are no-ops until Phase B (Proposal Generator)
// lands. The Prisma client itself is still wired so the back-evaluator and
// Order Tracker (Phase C) can pick it up without further plumbing.

import { PrismaClient } from '@prisma/client';
import type { Signal } from '@hunch-it/shared';
import { env } from '../env.js';

let prisma: PrismaClient | null = null;

export function getPrisma(): PrismaClient | null {
  if (prisma) return prisma;
  if (!env.DATABASE_URL) return null;
  prisma = new PrismaClient({ log: ['error'] });
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

export async function shutdownPrisma(): Promise<void> {
  if (prisma) await prisma.$disconnect();
}
