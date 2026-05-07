'use client';

import Link from 'next/link';

const LINKS: Array<{
  group: string;
  items: Array<{ label: string; href: string; external?: boolean }>;
}> = [
  {
    group: 'Product',
    items: [
      { label: 'Sign in', href: '/login' },
      { label: 'How it works', href: '#mechanic' },
      { label: 'Built on, not behind', href: '#why-us' },
    ],
  },
  {
    group: 'Open',
    items: [
      {
        label: 'GitHub',
        href: 'https://github.com/Omnis-Labs/hunch-it',
        external: true,
      },
      {
        label: 'Docs',
        href: 'https://github.com/Omnis-Labs/hunch-it/tree/main/docs',
        external: true,
      },
    ],
  },
];

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="mx-auto max-w-[1200px] px-6 pb-16 pt-24 sm:px-10">
      <div className="grid gap-12 border-t border-outline-variant pt-16 sm:grid-cols-[1.4fr_3fr]">
        <div>
          <div className="text-title-md font-semibold tracking-tight text-on-background">
            Hunch It<span className="text-on-surface-variant">.</span>
          </div>
          <p className="mt-3 max-w-[28ch] text-body-md text-on-surface-variant">
            Trade on your terms.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-8">
          {LINKS.map((g) => (
            <div key={g.group}>
              <div className="mb-4 font-mono text-label-sm uppercase tracking-[0.18em] text-on-surface-variant">
                {g.group}
              </div>
              <ul className="space-y-2.5">
                {g.items.map((it) => (
                  <li key={it.label}>
                    <Link
                      href={it.href}
                      className="text-body-md text-on-background transition-colors hover:text-on-surface-variant"
                      {...(it.external ? { target: '_blank', rel: 'noreferrer' } : {})}
                    >
                      {it.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-16 flex flex-col gap-3 border-t border-outline-variant pt-7 text-body-sm text-on-surface-variant sm:flex-row sm:items-center sm:justify-between">
        <span className="font-mono">© {year} Hunch It</span>
        <span className="max-w-[60ch]">
          Experimental software, not financial advice. Only use real funds if you understand the
          risks.
        </span>
      </div>
    </footer>
  );
}
