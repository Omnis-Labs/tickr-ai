import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/context';
import { devToolsGuard } from '@/lib/dev-tools/auth';

const DiagnosticStatusSchema = z.enum(['healthy', 'watch', 'risk', 'unknown']);
const LogSeveritySchema = z.enum(['info', 'success', 'warning', 'error']);
const LogSectionSchema = z.enum(['auth', 'proposal', 'orders', 'protection', 'swap']);

const ClientDiagnosticSchema = z.object({
  id: z.string().min(1).max(220),
  timestamp: z.string().min(1).max(80),
  section: LogSectionSchema,
  step: z.string().min(1).max(120),
  summary: z.string().min(1).max(1_200),
  severity: LogSeveritySchema,
  diagnostics: z
    .array(
      z.object({
        hypothesis: z.string().min(1).max(120),
        status: DiagnosticStatusSchema,
        detail: z.string().min(1).max(1_500),
      }),
    )
    .max(16),
  latencyMs: z.number().finite().nonnegative().max(300_000),
  payload: z.unknown().optional(),
  response: z.unknown().optional(),
  error: z.string().max(1_500).optional(),
  errorDetail: z.unknown().optional(),
});

function stringifyForTerminal(value: unknown): string {
  const text = JSON.stringify(value, null, 2);
  if (text.length <= 16_000) return text;
  return `${text.slice(0, 16_000)}\n... [terminal diagnostic truncated ${text.length - 16_000} chars]`;
}

export async function POST(req: NextRequest) {
  const guard = devToolsGuard(req);
  if (guard) return guard;

  const auth = await requireAuth(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body: unknown = await req.json().catch(() => null);
  const parsed = ClientDiagnosticSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid diagnostic' }, { status: 400 });
  }

  const event = parsed.data;
  const logPayload = {
    receivedAt: new Date().toISOString(),
    userId: auth.userId,
    walletAddress: auth.walletAddress,
    event,
  };
  const message = `[dev-tools:client-diagnostic] ${event.step} ${event.severity}\n${stringifyForTerminal(logPayload)}`;
  if (event.severity === 'error') console.error(message);
  else console.log(message);

  return NextResponse.json({ ok: true });
}
