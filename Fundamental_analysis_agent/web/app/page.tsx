export default function HomePage() {
  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-3xl font-semibold mb-2">
          US-stock — Fundamental Analysis Agent
        </h1>
        <p className="text-zinc-400 text-sm leading-relaxed max-w-3xl">
          Two systems, one repo. Production-grade discipline applied throughout:
          layered fallbacks, calibrated confidence, every LLM call cost-attributed
          to a ledger, eval as a service (not a script), failure modes surfaced
          rather than swallowed.
        </p>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <a
          href="/task1"
          className="group block border border-zinc-800 rounded-md p-5 hover:border-emerald-700 hover:bg-emerald-950/10 transition-colors"
        >
          <div className="flex items-baseline gap-2">
            <h2 className="text-lg font-semibold">Task 1</h2>
            <span className="text-xs text-zinc-500 uppercase tracking-wider">
              Browser Automation Agent
            </span>
          </div>
          <p className="text-sm text-zinc-400 mt-2 leading-relaxed">
            Natural-language task → explicit state machine{" "}
            <span className="text-cyan-400">PLAN</span> ·{" "}
            <span className="text-cyan-400">LOCATE</span> ·{" "}
            <span className="text-emerald-400">ACT</span> ·{" "}
            <span className="text-yellow-400">VERIFY</span> ·{" "}
            <span className="text-orange-400">DIAGNOSE</span>. Self-correction via
            typed root-cause classification, self-maintenance via three-pronged
            locator (CSS → ARIA role → visible text). Recovery proven by
            deterministic fault injection.
          </p>
          <div className="text-xs text-emerald-400 mt-3 group-hover:underline">
            Try it →
          </div>
        </a>

        <a
          href="/task2"
          className="group block border border-zinc-800 rounded-md p-5 hover:border-emerald-700 hover:bg-emerald-950/10 transition-colors"
        >
          <div className="flex items-baseline gap-2">
            <h2 className="text-lg font-semibold">Task 2</h2>
            <span className="text-xs text-zinc-500 uppercase tracking-wider">
              SEC 10-K Item Extractor
            </span>
          </div>
          <p className="text-sm text-zinc-400 mt-2 leading-relaxed">
            Paste any EDGAR 10-K URL → layered pipeline:{" "}
            <span className="text-emerald-400">L1</span> anchor →{" "}
            <span className="text-blue-400">L2</span> structural →{" "}
            <span className="text-purple-400">L3</span> LLM self-consistency.
            Each layer fires only when cheaper layers fall short — most filings
            extract at $0 LLM cost. Platt-calibrated confidence; quarantine on
            low confidence rather than emitting wrong data.
          </p>
          <div className="text-xs text-emerald-400 mt-3 group-hover:underline">
            Try it →
          </div>
        </a>

        <a
          href="/strategy"
          className="group block border border-zinc-800 rounded-md p-5 hover:border-emerald-700 hover:bg-emerald-950/10 transition-colors md:col-span-2"
        >
          <div className="flex items-baseline gap-2">
            <h2 className="text-lg font-semibold">Task 3</h2>
            <span className="text-xs text-zinc-500 uppercase tracking-wider">
              Fundamentals → Strategy → Backtest (built on Task 2)
            </span>
          </div>
          <p className="text-sm text-zinc-400 mt-2 leading-relaxed">
            Enter a ticker → its latest 10-K runs through Task 2 → an LLM forms a
            thesis and picks one executable strategy from a fixed menu, grounded in
            the filing (with citations). A{" "}
            <span className="text-amber-400">filing-date-aligned</span> backtest then
            tests it — signals act only <em>after</em> the 10-K was public, so there
            is no lookahead — shown as a candlestick with entry/exit markers, an
            equity curve vs buy-and-hold, and honest metrics (losses included).
            Quarantined 10-Ks are refused, not strategised.
          </p>
          <div className="text-xs text-emerald-400 mt-3 group-hover:underline">
            Try it →
          </div>
        </a>

        <a
          href="/technical"
          className="group block border border-zinc-800 rounded-md p-5 hover:border-emerald-700 hover:bg-emerald-950/10 transition-colors"
        >
          <div className="flex items-baseline gap-2">
            <h2 className="text-lg font-semibold">Task 4</h2>
            <span className="text-xs text-zinc-500 uppercase tracking-wider">
              Technicals → Strategy → Backtest
            </span>
          </div>
          <p className="text-sm text-zinc-400 mt-2 leading-relaxed">
            Enter a ticker → a snapshot of indicators (RSI, MACD, moving averages,
            Bollinger, Donchian, volume) computed strictly{" "}
            <span className="text-amber-400">as-of the most recent close</span> → an LLM
            picks one executable strategy from a fixed technical menu, grounded in those
            readings → a lookahead-free backtest over the trailing ~3 years. Signals act
            on the next bar&apos;s open.
          </p>
          <div className="text-xs text-emerald-400 mt-3 group-hover:underline">
            Try it →
          </div>
        </a>

        <a
          href="/ensemble"
          className="group block border border-zinc-800 rounded-md p-5 hover:border-emerald-700 hover:bg-emerald-950/10 transition-colors"
        >
          <div className="flex items-baseline gap-2">
            <h2 className="text-lg font-semibold">Task 5</h2>
            <span className="text-xs text-zinc-500 uppercase tracking-wider">
              Ensemble — Fundamental + Technical arbitration
            </span>
          </div>
          <p className="text-sm text-zinc-400 mt-2 leading-relaxed">
            Enter a ticker → the <span className="text-emerald-400">fundamental</span> agent
            (Task 3) and the <span className="text-blue-400">technical</span> agent (Task 4)
            run over one common window → an LLM <span className="text-purple-400">arbiter</span>{" "}
            fuses them, picking one combine policy from a fixed menu (AND / OR / weighted /
            gated / defer) from each agent&apos;s reasoning —{" "}
            <em>not</em> its returns, so the policy isn&apos;t fit to the test window. The
            combined position is backtested vs buy-and-hold and the S&amp;P 500. Degrades to
            technical-only when there is no usable 10-K.
          </p>
          <div className="text-xs text-emerald-400 mt-3 group-hover:underline">
            Try it →
          </div>
        </a>

        <a
          href="/insider"
          className="group block border border-zinc-800 rounded-md p-5 hover:border-emerald-700 hover:bg-emerald-950/10 transition-colors md:col-span-2"
        >
          <div className="flex items-baseline gap-2">
            <h2 className="text-lg font-semibold">Task 6</h2>
            <span className="text-xs text-zinc-500 uppercase tracking-wider">
              Insider (SEC Form 4) → Strategy → Backtest
            </span>
          </div>
          <p className="text-sm text-zinc-400 mt-2 leading-relaxed">
            Enter a ticker → its SEC <span className="text-blue-400">Form 4</span> filings are
            fetched and parsed into open-market insider transactions, keyed off each filing&apos;s{" "}
            <span className="text-amber-400">filing date</span> (not the trade date) so the backtest
            can only act once public. An LLM picks one strategy from a fixed insider-signal menu
            (cluster buying / net-$ buying / …) grounded in the as-of readings, then a lookahead-free
            backtest runs vs buy-and-hold and the S&amp;P 500. Only open-market buys/sales count —
            grants and option exercises are excluded, and selling is a weak exit signal, not a short.
          </p>
          <div className="text-xs text-emerald-400 mt-3 group-hover:underline">
            Try it →
          </div>
        </a>
      </section>

      <section className="border border-zinc-800 rounded-md p-5">
        <h2 className="text-sm font-semibold text-zinc-200 mb-2">
          What the dashboard shows
        </h2>
        <p className="text-sm text-zinc-400 leading-relaxed">
          The <a href="/dashboard" className="text-emerald-400 underline">/dashboard</a>{" "}
          surfaces eval pass-rates, recovery-rate, p50/p95 cost & latency, total
          ledger spend, cost-by-purpose / cost-by-model breakdowns, recent jobs,
          and the supported / unsupported capability matrix — every number is
          queried directly from the cost ledger or eval report.json, not
          estimated.
        </p>
      </section>

      <section className="text-xs text-zinc-500">
        <p>
          Full design in{" "}
          <a
            href="https://github.com/Omnis-Labs/hunch-it/blob/main/Fundamental_analysis_agent/PLAN.md"
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-300 hover:text-zinc-100 underline"
          >
            PLAN.md
          </a>
          {" · "}
          ADRs in{" "}
          <a
            href="https://github.com/Omnis-Labs/hunch-it/tree/main/Fundamental_analysis_agent/docs/adr"
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-300 hover:text-zinc-100 underline"
          >
            docs/adr
          </a>
          {" · "}
          Per-task analysis in{" "}
          <a
            href="https://github.com/Omnis-Labs/hunch-it/tree/main/Fundamental_analysis_agent/docs/analysis"
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-300 hover:text-zinc-100 underline"
          >
            docs/analysis
          </a>
          .
        </p>
      </section>
    </div>
  );
}
