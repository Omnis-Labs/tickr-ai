export interface AppNavigationItem {
  name: string;
  href: string;
  icon: string;
}

export const appNavigationItems: AppNavigationItem[] = [
  { name: 'Home', href: '/desk', icon: 'home' },
  { name: 'Grill', href: '/grill', icon: 'local_fire_department' },
  { name: 'Team', href: '/team', icon: 'groups' },
  { name: 'Portfolio', href: '/portfolio', icon: 'account_balance_wallet' },
];

const NAVLESS_PATHS = ['/', '/login', '/offline', '/mandate', '/dev-tools'];
const NAVLESS_PREFIXES = ['/proposals/'];

export function shouldShowAppNavigation(pathname: string): boolean {
  return (
    !NAVLESS_PATHS.includes(pathname) &&
    !NAVLESS_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

export function isAppNavigationItemActive(pathname: string, item: AppNavigationItem): boolean {
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
