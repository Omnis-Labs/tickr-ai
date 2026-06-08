export const REQUEST_PATHNAME_HEADER = 'x-hunch-pathname';

type PageGateStage = 'SIGNED_OUT' | 'NEEDS_MANDATE' | 'READY';

interface PageGateSession {
  stage: PageGateStage;
}

const READY_ONLY_PREFIXES = [
  '/desk',
  '/grill',
  '/portfolio',
  '/positions',
  '/proposals',
  '/settings',
  '/signals',
  '/team',
];

function normalizePath(rawPathname: string): string {
  const [pathOnly = '/'] = rawPathname.split(/[?#]/);
  if (!pathOnly.startsWith('/')) return '/';
  return pathOnly === '' ? '/' : pathOnly;
}

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isGatedPagePath(rawPathname: string): boolean {
  const pathname = normalizePath(rawPathname);
  return (
    pathname === '/mandate' || READY_ONLY_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix))
  );
}

export function redirectPathForPage(rawPathname: string, session: PageGateSession): string | null {
  const pathname = normalizePath(rawPathname);

  if (pathname === '/mandate') {
    if (session.stage === 'SIGNED_OUT') return `/login?next=${encodeURIComponent(pathname)}`;
    return null;
  }

  if (READY_ONLY_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix))) {
    if (session.stage === 'SIGNED_OUT') return `/login?next=${encodeURIComponent(pathname)}`;
    if (session.stage === 'NEEDS_MANDATE') return '/mandate';
    return null;
  }

  return null;
}
