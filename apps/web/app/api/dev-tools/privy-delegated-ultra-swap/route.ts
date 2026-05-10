import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/context';
import { devToolsGuard } from '@/lib/dev-tools/auth';
import {
  DevPrivyDelegatedUltraSwapError,
  getPrivyDelegatedUltraSwapStatus,
  runPrivyDelegatedUltraSwapDevTool,
} from '@/lib/dev-tools/privy-delegated-ultra-swap';

export const dynamic = 'force-dynamic';

const Schema = z.object({
  orderId: z.string().min(1),
});

function compactError(err: unknown): { error: string; detail?: unknown; status: number } {
  if (err instanceof DevPrivyDelegatedUltraSwapError) {
    return { error: err.message, detail: err.detail, status: err.status };
  }
  if (err instanceof Error) {
    return { error: err.message, status: 500 };
  }
  return { error: String(err), status: 500 };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const guard = devToolsGuard(req);
  if (guard) return guard;

  const auth = await requireAuth(req);
  if (!auth) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  try {
    const result = await getPrivyDelegatedUltraSwapStatus({ auth });
    return NextResponse.json(result);
  } catch (err) {
    const { status, ...body } = compactError(err);
    return NextResponse.json({ ok: false, ...body }, { status });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = devToolsGuard(req);
  if (guard) return guard;

  const body: unknown = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'invalid payload', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const auth = await requireAuth(req);
  if (!auth) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  try {
    const result = await runPrivyDelegatedUltraSwapDevTool({
      auth,
      orderId: parsed.data.orderId,
    });
    return NextResponse.json(result);
  } catch (err) {
    const { status, ...body } = compactError(err);
    return NextResponse.json({ ok: false, ...body }, { status });
  }
}
