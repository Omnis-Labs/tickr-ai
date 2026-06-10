import { NextResponse, type NextRequest } from 'next/server';
import { PythBenchmarkRequestError } from '@hunch-it/shared';
import { requireAuth } from '@/lib/auth/context';
import { GrillRequestSchema, runGrillAnalysis } from '@/lib/grill/server';

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
    const analysis = await runGrillAnalysis(parsed.data);
    return NextResponse.json({ analysis });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof PythBenchmarkRequestError) {
      console.warn('[grill] market data temporarily unavailable', err);
      return NextResponse.json(
        {
          error: 'temporary_market_data_unavailable',
          message: 'Market data is temporarily unavailable. Re-analyze in a moment.',
        },
        { status: 503 },
      );
    }
    console.warn('[grill] analysis failed', err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
