"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";

const GROUPS: { title: string; items: { href: string; label: string }[] }[] = [
  {
    title: "Tools",
    items: [
      { href: "/task1", label: "T1 · Browser agent" },
      { href: "/task2", label: "T2 · 10-K extractor" },
    ],
  },
  {
    title: "Signal agents",
    items: [
      { href: "/strategy", label: "T3 · Fundamental (10-K)" },
      { href: "/technical", label: "T4 · Technical" },
      { href: "/insider", label: "T6 · Insider (Form 4)" },
      { href: "/relative", label: "T7 · Relative strength" },
      { href: "/earnings", label: "T8 · Earnings (8-K)" },
      { href: "/institutional", label: "T9 · Institutional (13F)" },
      { href: "/fundamentals", label: "T11 · Fundamentals trend" },
      { href: "/seasonality", label: "T12 · Seasonality" },
      { href: "/overnight", label: "T13 · Overnight / gap" },
      { href: "/volatility", label: "T14 · Volatility regime" },
      { href: "/buyback", label: "T15 · Buyback" },
      { href: "/short", label: "T16 · Short pressure" },
    ],
  },
  {
    title: "Fusion & portfolio",
    items: [
      { href: "/ensemble", label: "T5 · Ensemble" },
      { href: "/portfolio", label: "T10 · Portfolio sizing" },
    ],
  },
];

const ALL = GROUPS.flatMap((g) => g.items);

export default function NavLinks() {
  const pathname = usePathname() || "/";
  const [open, setOpen] = useState(false);
  const isActive = (h: string) => pathname === h || pathname.startsWith(h + "/");
  const current = ALL.find((it) => isActive(it.href));

  return (
    <div className="relative flex items-center gap-4 text-sm">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 ${open || current ? "text-zinc-100" : "text-zinc-300"} hover:text-zinc-100`}
      >
        Agents <span className="text-zinc-500">({ALL.length})</span>
        <span className={`text-[10px] transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>

      {current && (
        <span className="hidden md:inline text-emerald-400 truncate max-w-[14rem]">
          {current.label}
        </span>
      )}

      <a
        href="/dashboard"
        className={isActive("/dashboard")
          ? "text-zinc-100 border-b-2 border-emerald-400 -mb-px"
          : "text-zinc-400 hover:text-zinc-100"}
      >
        Dashboard
      </a>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute top-full left-0 mt-3 z-50 w-[min(92vw,720px)] rounded-lg border border-zinc-800 bg-zinc-900 p-4 shadow-xl grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-4">
            {GROUPS.map((g) => (
              <div key={g.title}>
                <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-2">{g.title}</div>
                <div className="flex flex-col gap-1.5">
                  {g.items.map((it) => (
                    <a
                      key={it.href}
                      href={it.href}
                      onClick={() => setOpen(false)}
                      className={isActive(it.href)
                        ? "text-emerald-400"
                        : "text-zinc-300 hover:text-zinc-100"}
                    >
                      {it.label}
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
