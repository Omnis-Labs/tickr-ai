import { redirect } from 'next/navigation';
import { resolveSessionFromCookies } from '@/lib/auth/session';
import { LandingMarketing } from '@/components/landing/marketing';

export default async function RootPage() {
  const session = await resolveSessionFromCookies();
  if (session.stage === 'READY') redirect('/desk');
  if (session.stage === 'NEEDS_MANDATE') redirect('/mandate');
  return <LandingMarketing />;
}
