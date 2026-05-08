import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@hunch-it/db';
import type { BaseMarketAnalysis } from '@hunch-it/shared';
import type { Server as IoServer } from 'socket.io';
import { generateProposalsForBaseAnalysis } from './generator.js';

const base: BaseMarketAnalysis = {
  assetId: 'NVDAx',
  action: 'BUY',
  confidence: 0.8,
  rationale: 'RSI recovery with bullish MACD.',
  what_changed: 'Momentum improved.',
  why_this_trade: 'The setup has a favorable trigger.',
  priceAtAnalysis: 100,
  indicators: {
    rsi: 42,
    macd: { macd: 1, signal: 0.5, histogram: 0.5 },
    ma20: 98,
    ma50: 95,
  },
};

test('generateProposalsForBaseAnalysis skips a user with a live BUY proposal for the asset', async () => {
  const prisma = {
    user: {
      findMany: async (args: {
        include: { proposals: { where: { ticker: string; action: string; status: string } } };
      }) => {
        assert.equal(args.include.proposals.where.ticker, 'NVDAx');
        assert.equal(args.include.proposals.where.action, 'BUY');
        assert.equal(args.include.proposals.where.status, 'ACTIVE');
        return [
          {
            id: 'user-1',
            walletAddress: 'wallet-1',
            mandate: {
              holdingPeriod: '1-2 weeks',
              maxTradeSize: { toNumber: () => 500 },
              maxDrawdown: { toNumber: () => 0.05 },
            },
            positions: [],
            proposals: [{ id: 'proposal-1' }],
          },
        ];
      },
    },
  } as unknown as PrismaClient;

  const io = {
    to: () => ({
      emit: () => {
        throw new Error('duplicate proposal should not emit');
      },
    }),
  } as unknown as IoServer;

  const summary = await generateProposalsForBaseAnalysis(prisma, io, base);
  assert.deepEqual(summary, {
    matchingUsers: 1,
    proposalsCreated: 0,
    errors: 0,
  });
});
