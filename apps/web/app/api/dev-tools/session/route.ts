import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  createDevToolsLoginResponse,
  createDevToolsLogoutResponse,
  devToolsEnabled,
  devToolsPassword,
  devToolsStatus,
} from '@/lib/dev-tools/auth';

const LoginSchema = z.object({
  password: z.string().min(1),
});

export async function GET(req: NextRequest) {
  if (!devToolsEnabled()) {
    return NextResponse.json({ error: 'dev tools disabled' }, { status: 404 });
  }
  return NextResponse.json(devToolsStatus(req));
}

export async function POST(req: NextRequest) {
  if (!devToolsEnabled()) {
    return NextResponse.json({ error: 'dev tools disabled' }, { status: 404 });
  }

  const body: unknown = await req.json().catch(() => null);
  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success || parsed.data.password !== devToolsPassword()) {
    console.warn('[dev-tools] password rejected');
    return NextResponse.json({ error: 'invalid password' }, { status: 401 });
  }

  console.log('[dev-tools] password accepted');
  return createDevToolsLoginResponse();
}

export async function DELETE() {
  if (!devToolsEnabled()) {
    return NextResponse.json({ error: 'dev tools disabled' }, { status: 404 });
  }
  return createDevToolsLogoutResponse();
}
