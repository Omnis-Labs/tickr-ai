import { NextResponse, type NextRequest } from 'next/server';
import { resolveSession } from '@/lib/auth/session';

export async function GET(req: NextRequest) {
  const state = await resolveSession(req);
  return NextResponse.json(state);
}
