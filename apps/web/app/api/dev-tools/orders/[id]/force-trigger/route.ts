import { NextResponse, type NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/context';
import { devToolsGuard } from '@/lib/dev-tools/auth';
import {
  buildOwnedDevTriggerPayload,
  emitDevTrigger,
} from '@/lib/dev-tools/server';

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const guard = devToolsGuard(req);
  if (guard) return guard;

  const auth = await requireAuth(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  try {
    const trigger = await buildOwnedDevTriggerPayload({
      userId: auth.userId,
      orderId: id,
    });
    const emitted = await emitDevTrigger(trigger);
    return NextResponse.json(emitted);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[dev-tools] force trigger failed order=${id}`, err);
    const status = message.includes('DEV_TOOLS') ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
