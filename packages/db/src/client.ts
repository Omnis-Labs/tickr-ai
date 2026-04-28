// Prisma client singleton, shared by apps/web (server-side) and apps/ws-server.
//
// Both apps were keeping their own per-process getPrisma() — bringing it here
// guarantees a single connection pool and a single migration history. Apps
// import { prisma } from '@hunch-it/db' and that's it.

import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __hunchPrisma: PrismaClient | undefined;
}

function makeClient(): PrismaClient {
  return new PrismaClient({
    log:
      process.env.PRISMA_LOG === 'debug'
        ? ['query', 'info', 'warn', 'error']
        : ['warn', 'error'],
  });
}

export const prisma: PrismaClient =
  globalThis.__hunchPrisma ?? (globalThis.__hunchPrisma = makeClient());

export async function shutdownPrisma(): Promise<void> {
  await prisma.$disconnect().catch(() => {});
}
