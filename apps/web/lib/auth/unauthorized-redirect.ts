'use client';

interface UnauthorizedRedirectInput {
  requestUrl: string;
  currentPath: string;
  currentSearch: string;
  sentAuthorization: boolean;
  origin?: string;
}

const PUBLIC_UNAUTHORIZED_API_PATHS = new Set(['/api/users/me', '/api/me/state']);

export function redirectTargetForUnauthorized({
  requestUrl,
  currentPath,
  currentSearch,
  sentAuthorization,
  origin = 'http://localhost',
}: UnauthorizedRedirectInput): string | null {
  if (!sentAuthorization) return null;
  if (currentPath === '/login') return null;

  let requestPath: string;
  try {
    requestPath = new URL(requestUrl, origin).pathname;
  } catch {
    return null;
  }

  if (!requestPath.startsWith('/api/')) return null;
  if (PUBLIC_UNAUTHORIZED_API_PATHS.has(requestPath)) return null;

  const next = encodeURIComponent(`${currentPath}${currentSearch}`);
  return `/login?reason=session-expired&next=${next}`;
}
