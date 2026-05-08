import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { extractBearer } from '@/lib/auth/privy';
import { requireAuth } from '@/lib/auth/context';
import { devToolsGuard } from '@/lib/dev-tools/auth';
import {
  DevPrivyDelegatedUltraError,
  runPrivyDelegatedUltraDevTool,
} from '@/lib/dev-tools/privy-delegated-ultra';

export const dynamic = 'force-dynamic';

const Schema = z.object({
  orderId: z.string().min(1),
  mode: z.enum(['preview', 'execute']).default('preview'),
  authorizationMode: z.enum(['user-jwt', 'server-key', 'combined']).default('user-jwt'),
});

function compactError(err: unknown): { error: string; detail?: unknown; status: number } {
  if (err instanceof DevPrivyDelegatedUltraError) {
    return { error: err.message, detail: err.detail, status: err.status };
  }
  if (err instanceof Error) {
    return { error: err.message, status: 500 };
  }
  return { error: String(err), status: 500 };
}

export async function POST(req: NextRequest) {
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
    const result = await runPrivyDelegatedUltraDevTool({
      auth,
      userJwt: extractBearer(req),
      orderId: parsed.data.orderId,
      mode: parsed.data.mode,
      authorizationMode: parsed.data.authorizationMode,
    });
    return NextResponse.json(result);
  } catch (err) {
    const { status, ...body } = compactError(err);
    return NextResponse.json({ ok: false, ...body }, { status });
  }
}
