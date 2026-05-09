import { NextResponse, type NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/context';
import { getDelegatedExecutionStatus } from '@/lib/delegated-execution/status';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  try {
    const status = await getDelegatedExecutionStatus(auth);
    return NextResponse.json(status);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
