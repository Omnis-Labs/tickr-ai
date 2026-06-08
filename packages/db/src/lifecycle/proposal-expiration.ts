import { Prisma, type ProposalOrigin } from '../../generated/prisma/index.js';
import { prisma } from '../client.js';

type Tx = Prisma.TransactionClient;

export async function expireActiveProposals(
  client: Tx | typeof prisma,
  input: {
    userId?: string;
    origin?: ProposalOrigin;
    now?: Date;
  } = {},
): Promise<number> {
  const where: Prisma.ProposalWhereInput = {
    status: 'ACTIVE',
    expiresAt: { lte: input.now ?? new Date() },
  };

  if (input.userId) where.userId = input.userId;
  if (input.origin) where.origin = input.origin;

  const result = await client.proposal.updateMany({
    where,
    data: { status: 'EXPIRED' },
  });

  return result.count;
}
