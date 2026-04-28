import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { DEMO_MANDATE, MandateInputSchema } from '@hunch-it/shared';
import { prisma } from '@/lib/db';
import { isDemoServer } from '@/lib/demo/flag';

/**
 * GET    /api/mandates?wallet=<address>          Returns the user's mandate, or null.
 * POST   /api/mandates  body: { walletAddress, ...MandateInput }   Creates first mandate.
 * PUT    /api/mandates  body: { walletAddress, ...MandateInput }   Updates mandate.
 *
 * Demo mode: GET returns the in-memory DEMO_MANDATE; POST/PUT echo back the
 * submitted shape without touching the DB.
 */

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get('wallet');
  if (!wallet) {
    return NextResponse.json({ mandate: null });
  }
  if (isDemoServer()) {
    return NextResponse.json({ mandate: DEMO_MANDATE });
  }
  const user = await prisma.user.findUnique({ where: { walletAddress: wallet } });
  if (!user) return NextResponse.json({ mandate: null });
  const mandate = await prisma.mandate.findUnique({ where: { userId: user.id } });
  return NextResponse.json({ mandate });
}

const PostSchema = MandateInputSchema.extend({
  walletAddress: z.string().min(32),
  privyUserId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const body: unknown = await req.json().catch(() => null);
  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { walletAddress, privyUserId, ...mandateInput } = parsed.data;

  if (isDemoServer()) {
    return NextResponse.json({
      mandate: { ...DEMO_MANDATE, ...mandateInput, updatedAt: new Date().toISOString() },
    });
  }

  const user = await prisma.user.upsert({
    where: { walletAddress },
    update: privyUserId ? { privyUserId } : {},
    create: { walletAddress, ...(privyUserId ? { privyUserId } : {}) },
  });

  const mandate = await prisma.mandate.upsert({
    where: { userId: user.id },
    update: {
      holdingPeriod: mandateInput.holdingPeriod,
      maxDrawdown: mandateInput.maxDrawdown,
      maxTradeSize: mandateInput.maxTradeSize,
      marketFocus: mandateInput.marketFocus,
    },
    create: {
      userId: user.id,
      holdingPeriod: mandateInput.holdingPeriod,
      maxDrawdown: mandateInput.maxDrawdown,
      maxTradeSize: mandateInput.maxTradeSize,
      marketFocus: mandateInput.marketFocus,
    },
  });

  return NextResponse.json({ mandate });
}

export async function PUT(req: NextRequest) {
  const body: unknown = await req.json().catch(() => null);
  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { walletAddress, ...mandateInput } = parsed.data;

  if (isDemoServer()) {
    return NextResponse.json({
      mandate: { ...DEMO_MANDATE, ...mandateInput, updatedAt: new Date().toISOString() },
    });
  }

  const user = await prisma.user.findUnique({ where: { walletAddress } });
  if (!user) {
    return NextResponse.json({ error: 'user not found' }, { status: 404 });
  }

  const mandate = await prisma.mandate.upsert({
    where: { userId: user.id },
    update: {
      holdingPeriod: mandateInput.holdingPeriod,
      maxDrawdown: mandateInput.maxDrawdown,
      maxTradeSize: mandateInput.maxTradeSize,
      marketFocus: mandateInput.marketFocus,
    },
    create: {
      userId: user.id,
      holdingPeriod: mandateInput.holdingPeriod,
      maxDrawdown: mandateInput.maxDrawdown,
      maxTradeSize: mandateInput.maxTradeSize,
      marketFocus: mandateInput.marketFocus,
    },
  });

  // TODO (Phase B): mark all ACTIVE Proposals for this user as EXPIRED so
  // the Proposal Generator regenerates against the new mandate.

  return NextResponse.json({ mandate });
}
