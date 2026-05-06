import { NextResponse, type NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/context';
import { devToolsGuard } from '@/lib/dev-tools/auth';
import { listDevToolsState } from '@/lib/dev-tools/server';

export async function GET(req: NextRequest) {
  const guard = devToolsGuard(req);
  if (guard) return guard;

  const auth = await requireAuth(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const state = await listDevToolsState(auth.userId);
  return NextResponse.json({ ok: true, ...state });
}
