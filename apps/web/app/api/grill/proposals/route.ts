import { NextResponse, type NextRequest } from 'next/server';
import { PythBenchmarkRequestError } from '@hunch-it/shared';
import { requireAuth } from '@/lib/auth/context';
import { GrillRequestSchema, createGrillProposal } from '@/lib/grill/server';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body: unknown = await req.json().catch(() => null);
  const parsed = GrillRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const result = await createGrillProposal({
      ...parsed.data,
      userId: auth.userId,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof PythBenchmarkRequestError) {
      console.warn('[grill] proposal market data temporarily unavailable', err);
      return NextResponse.json(
        {
          error: 'temporary_market_data_unavailable',
          message: 'Market data is temporarily unavailable. Re-analyze in a moment.',
        },
        { status: 503 },
      );
    }
    console.warn('[grill] proposal create failed', err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
