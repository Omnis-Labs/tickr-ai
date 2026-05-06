import { notFound } from 'next/navigation';
import { devToolsEnabled } from '@/lib/dev-tools/auth';
import { DevToolsClient } from './dev-tools-client';

export default function DevToolsPage() {
  if (!devToolsEnabled()) notFound();
  return <DevToolsClient />;
}
