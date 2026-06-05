import "./globals.css";
import type { Metadata } from "next";
import NavLinks from "./_nav";

export const metadata: Metadata = {
  title: "US-stock LLM Test",
  description:
    "Browser Agent (Task 1) + SEC 10-K Item Extractor (Task 2) + Strategy Lab (Task 3). US-stock AI Coding Test 2026.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 font-mono antialiased">
        <header className="sticky top-0 z-40 backdrop-blur bg-zinc-950/80 border-b border-zinc-800 px-6 py-3">
          <div className="max-w-6xl mx-auto flex items-center gap-6 text-sm">
            <a href="/" className="font-semibold text-zinc-100 shrink-0">
              <span className="text-emerald-400">●</span> US-stock-llm-test
            </a>
            <NavLinks />
            <div className="flex-1" />
            <a
              href="https://github.com/ChiShengChen/whaleforce-llm-test"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-zinc-500 hover:text-zinc-200"
            >
              GitHub ↗
            </a>
          </div>
        </header>
        <main className="px-6 py-6 max-w-6xl mx-auto">{children}</main>
        <footer className="border-t border-zinc-900 px-6 py-4 mt-12">
          <div className="max-w-6xl mx-auto text-xs text-zinc-600 flex flex-wrap gap-4">
            <span>US-stock LLM Engineer Coding Test 2026</span>
            <span>·</span>
            <a href="/dashboard" className="hover:text-zinc-300">Dashboard</a>
            <span>·</span>
            <a
              href="https://github.com/ChiShengChen/whaleforce-llm-test/blob/main/docs/VERIFICATION.md"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-zinc-300"
            >
              Verification report
            </a>
          </div>
        </footer>
      </body>
    </html>
  );
}
