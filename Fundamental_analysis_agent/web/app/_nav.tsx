"use client";

import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/task1", label: "Task 1 · Browser Agent" },
  { href: "/task2", label: "Task 2 · 10-K Extractor" },
  { href: "/strategy", label: "Task 3 · Strategy Lab" },
  { href: "/technical", label: "Task 4 · Technical Lab" },
  { href: "/ensemble", label: "Task 5 · Ensemble" },
  { href: "/insider", label: "Task 6 · Insider" },
  { href: "/dashboard", label: "Dashboard" },
];

export default function NavLinks() {
  const pathname = usePathname() || "/";
  return (
    <nav className="flex gap-4 text-sm">
      {ITEMS.map((it) => {
        const active = pathname === it.href || pathname.startsWith(it.href + "/");
        return (
          <a
            key={it.href}
            href={it.href}
            className={
              active
                ? "text-zinc-100 border-b-2 border-emerald-400 -mb-px"
                : "text-zinc-400 hover:text-zinc-100"
            }
          >
            {it.label}
          </a>
        );
      })}
    </nav>
  );
}
