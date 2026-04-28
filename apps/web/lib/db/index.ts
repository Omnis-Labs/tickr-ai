// Re-export the canonical Prisma client from @hunch-it/db. The schema +
// migrations live in packages/db; both apps share a single connection
// pool and a single migration history.
export { prisma, shutdownPrisma } from '@hunch-it/db';
