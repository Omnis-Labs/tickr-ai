import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient, Proposal } from '@hunch-it/db';
import type { BaseMarketAnalysis } from '@hunch-it/shared';
import type { Server as IoServer } from 'socket.io';
import { generateProposalsForBaseAnalysis, serializeProposalForClient } from './generator.js';

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

test('serializeProposalForClient emits numbers for Decimal proposal fields', () => {
  const decimal = (value: number) => ({ toNumber: () => value });
  const serialized = serializeProposalForClient({
    id: 'proposal-1',
    userId: 'user-1',
    ticker: 'QQQx',
    action: 'BUY',
    suggestedSizeUsd: decimal(5),
    suggestedTriggerPrice: decimal(715.26),
    suggestedTakeProfitPrice: decimal(743.87),
    suggestedStopLossPrice: decimal(697.38),
    rationale: 'RSI at 24.07 indicates oversold conditions.',
    reasoning: {
      what_changed: 'RSI at 24.07 indicates oversold conditions.',
      why_this_trade: 'Expect a mean reversion bounce.',
      why_fits_mandate: 'Size $5.00 is based on your $19.23 USDC balance.',
    },
    positionImpact: {
      weight_before: 0,
      weight_after: 0.26,
      cash_after: 14.23,
      sector_before: 0,
      sector_after: 0.26,
    },
    confidence: decimal(0.72),
    priceAtProposal: decimal(717.05),
    indicators: { rsi: 24.07, ma20: 715.26, ma50: 715.14 },
    thesisTags: ['rsi_oversold'],
    sourceBuyProposalId: null,
    positionId: null,
    triggeringTag: null,
    origin: 'SIGNAL_ENGINE',
    status: 'ACTIVE',
    expiresAt: new Date('2026-05-09T12:00:00.000Z'),
    createdAt: new Date('2026-05-09T10:30:00.000Z'),
    evaluatedAt: null,
    priceAfter: null,
    pctChange: null,
    outcome: null,
  } as unknown as Proposal);

  assert.equal(serialized.confidence, 0.72);
  assert.equal(serialized.suggestedSizeUsd, 5);
  assert.equal(serialized.suggestedTriggerPrice, 715.26);
  assert.equal(serialized.suggestedTakeProfitPrice, 743.87);
  assert.equal(serialized.suggestedStopLossPrice, 697.38);
  assert.equal(serialized.priceAtProposal, 717.05);
  assert.equal(serialized.expiresAt, '2026-05-09T12:00:00.000Z');
  assert.equal(serialized.createdAt, '2026-05-09T10:30:00.000Z');
});
