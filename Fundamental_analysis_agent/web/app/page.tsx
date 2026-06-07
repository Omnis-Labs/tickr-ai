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

        <a
          href="/relative"
          className="group block border border-zinc-800 rounded-md p-5 hover:border-emerald-700 hover:bg-emerald-950/10 transition-colors md:col-span-2"
        >
          <div className="flex items-baseline gap-2">
            <h2 className="text-lg font-semibold">Task 7</h2>
            <span className="text-xs text-zinc-500 uppercase tracking-wider">
              Peer / Sector Relative Strength → Strategy → Backtest
            </span>
          </div>
          <p className="text-sm text-zinc-400 mt-2 leading-relaxed">
            Enter a ticker → we resolve its <span className="text-blue-400">sector ETF</span> from
            the SEC SIC code (S&amp;P 500 fallback) and compute a{" "}
            <span className="text-amber-400">relative-strength</span> series (stock ÷ sector),
            strictly as-of the latest close. An LLM picks one strategy from a fixed RS menu (uptrend
            / breakout / momentum); a lookahead-free backtest then holds the <em>stock</em> long/flat
            with RS deciding only when to be long — vs buy-and-hold and the S&amp;P 500. Surfaces
            nuances like “beating the market but lagging its own sector.”
          </p>
          <div className="text-xs text-emerald-400 mt-3 group-hover:underline">
            Try it →
          </div>
        </a>

        <a
          href="/portfolio"
          className="group block border border-zinc-800 rounded-md p-5 hover:border-emerald-700 hover:bg-emerald-950/10 transition-colors md:col-span-2"
        >
          <div className="flex items-baseline gap-2">
            <h2 className="text-lg font-semibold">Task 10</h2>
            <span className="text-xs text-zinc-500 uppercase tracking-wider">
              Portfolio / Risk Sizing — the capstone
            </span>
          </div>
          <p className="text-sm text-zinc-400 mt-2 leading-relaxed">
            Enter a watchlist → each name&apos;s long/flat signal comes from the{" "}
            <span className="text-cyan-400">Task 4</span> agent; an LLM picks one{" "}
            <span className="text-purple-400">sizing policy</span> (equal-weight / inverse-vol /
            risk-parity / signal-proportional + single-name cap, gross cap, vol target, rebalance)
            from as-of universe stats — not per-name weights, which are deterministic. A lookahead-free{" "}
            <span className="text-amber-400">portfolio backtest</span> then allocates across names vs
            an equal-weight basket and the S&amp;P 500. The piece that turns the signal agents into a
            sized, risk-controlled book.
          </p>
          <div className="text-xs text-emerald-400 mt-3 group-hover:underline">
            Try it →
          </div>
        </a>

        <a
          href="/earnings"
          className="group block border border-zinc-800 rounded-md p-5 hover:border-emerald-700 hover:bg-emerald-950/10 transition-colors md:col-span-2"
        >
          <div className="flex items-baseline gap-2">
            <h2 className="text-lg font-semibold">Task 8</h2>
            <span className="text-xs text-zinc-500 uppercase tracking-wider">
              Earnings (SEC 8-K) → Strategy → PEAD Backtest
            </span>
          </div>
          <p className="text-sm text-zinc-400 mt-2 leading-relaxed">
            Enter a ticker → its recent earnings <span className="text-blue-400">press releases</span>{" "}
            (8-K Item 2.02 / Ex-99.1) are fetched; an LLM classifies each{" "}
            <span className="text-amber-400">as-of its filing date</span> (sentiment / guidance /
            beat-miss, with citations); then it trades the{" "}
            <span className="text-purple-400">post-earnings drift</span> — lookahead-free, acting only
            on the open after each filing, vs buy-and-hold and the S&amp;P 500. Reads the press
            release, not the live Q&amp;A transcript (source is pluggable).
          </p>
          <div className="text-xs text-emerald-400 mt-3 group-hover:underline">
            Try it →
          </div>
        </a>

        <a
          href="/institutional"
          className="group block border border-zinc-800 rounded-md p-5 hover:border-emerald-700 hover:bg-emerald-950/10 transition-colors md:col-span-2"
        >
          <div className="flex items-baseline gap-2">
            <h2 className="text-lg font-semibold">Task 9</h2>
            <span className="text-xs text-zinc-500 uppercase tracking-wider">
              Institutional (13F) superinvestor tracking → Strategy → Backtest
            </span>
          </div>
          <p className="text-sm text-zinc-400 mt-2 leading-relaxed">
            Enter a ticker → we track a curated set of <span className="text-blue-400">well-known
            managers</span> (Berkshire, Baupost, Pershing Square, …) via their SEC{" "}
            <span className="text-blue-400">13F-HR</span> filings and follow whether they&apos;re{" "}
            <span className="text-amber-400">accumulating</span> the name. An LLM picks a follow-the-
            smart-money strategy; the backtest is keyed off the 13F filing date (~45-day lag → a
            lookahead-safe but slow confirmation signal). Curated funds only, matched by issuer name —
            both surfaced honestly.
          </p>
          <div className="text-xs text-emerald-400 mt-3 group-hover:underline">
            Try it →
          </div>
        </a>

        <a href="/fundamentals" className="group block border border-zinc-800 rounded-md p-5 hover:border-emerald-700 hover:bg-emerald-950/10 transition-colors">
          <div className="flex items-baseline gap-2"><h2 className="text-lg font-semibold">Task 11</h2>
            <span className="text-xs text-zinc-500 uppercase tracking-wider">Fundamentals Trend (XBRL)</span></div>
          <p className="text-sm text-zinc-400 mt-2 leading-relaxed">
            Structured quarterly financials from <span className="text-blue-400">SEC XBRL</span> →
            lookahead-safe <span className="text-amber-400">fundamental momentum</span> (YoY revenue/
            earnings growth + margin trend, keyed off the filing date, as-originally-reported) → backtest.
            Task 3 reads the 10-K text; this reads the numbers.
          </p>
          <div className="text-xs text-emerald-400 mt-3 group-hover:underline">Try it →</div>
        </a>

        <a href="/seasonality" className="group block border border-zinc-800 rounded-md p-5 hover:border-emerald-700 hover:bg-emerald-950/10 transition-colors">
          <div className="flex items-baseline gap-2"><h2 className="text-lg font-semibold">Task 12</h2>
            <span className="text-xs text-zinc-500 uppercase tracking-wider">Seasonality / Calendar Effects</span></div>
          <p className="text-sm text-zinc-400 mt-2 leading-relaxed">
            Month-of-year returns, sell-in-May, turn-of-month → an LLM picks a{" "}
            <span className="text-amber-400">calendar rule</span> (lookahead-free to execute). Honest that
            the pattern is in-sample — weak signals default to buy-and-hold rather than overfit.
          </p>
          <div className="text-xs text-emerald-400 mt-3 group-hover:underline">Try it →</div>
        </a>

        <a href="/overnight" className="group block border border-zinc-800 rounded-md p-5 hover:border-emerald-700 hover:bg-emerald-950/10 transition-colors md:col-span-2">
          <div className="flex items-baseline gap-2"><h2 className="text-lg font-semibold">Task 13</h2>
            <span className="text-xs text-zinc-500 uppercase tracking-wider">Overnight vs Intraday (Gap)</span></div>
          <p className="text-sm text-zinc-400 mt-2 leading-relaxed">
            Splits returns into the <span className="text-amber-400">overnight</span> (close→open) vs{" "}
            <span className="text-amber-400">intraday</span> (open→close) move — the documented anomaly that
            most US-equity return accrues overnight — then backtests a participation rule{" "}
            <strong>honestly net of the daily round-trip cost</strong> that usually erases the gross edge.
          </p>
          <div className="text-xs text-emerald-400 mt-3 group-hover:underline">Try it →</div>
        </a>

        <a href="/volatility" className="group block border border-zinc-800 rounded-md p-5 hover:border-emerald-700 hover:bg-emerald-950/10 transition-colors">
          <div className="flex items-baseline gap-2"><h2 className="text-lg font-semibold">Task 14</h2>
            <span className="text-xs text-zinc-500 uppercase tracking-wider">Volatility Regime / Risk Mgmt</span></div>
          <p className="text-sm text-zinc-400 mt-2 leading-relaxed">Trailing realized <span className="text-amber-400">volatility</span> +
          percentile → a vol-managed long/flat rule: participate when calm, step aside when vol spikes. Judged on risk-adjusted terms.</p>
          <div className="text-xs text-emerald-400 mt-3 group-hover:underline">Try it →</div>
        </a>

        <a href="/buyback" className="group block border border-zinc-800 rounded-md p-5 hover:border-emerald-700 hover:bg-emerald-950/10 transition-colors">
          <div className="flex items-baseline gap-2"><h2 className="text-lg font-semibold">Task 15</h2>
            <span className="text-xs text-zinc-500 uppercase tracking-wider">Share Buybacks (XBRL)</span></div>
          <p className="text-sm text-zinc-400 mt-2 leading-relaxed">Falling diluted <span className="text-blue-400">share count</span> from
          SEC XBRL = net <span className="text-amber-400">buybacks</span> → follow sustained repurchases. Lookahead-safe, quarterly.</p>
          <div className="text-xs text-emerald-400 mt-3 group-hover:underline">Try it →</div>
        </a>

        <a href="/short" className="group block border border-zinc-800 rounded-md p-5 hover:border-emerald-700 hover:bg-emerald-950/10 transition-colors md:col-span-2">
          <div className="flex items-baseline gap-2"><h2 className="text-lg font-semibold">Task 16</h2>
            <span className="text-xs text-zinc-500 uppercase tracking-wider">Short Pressure / Squeeze (FINRA)</span></div>
          <p className="text-sm text-zinc-400 mt-2 leading-relaxed">FINRA daily <span className="text-amber-400">short-volume</span> ratio
          (weekly-sampled, cached) → a squeeze / low-short rule. Honestly flagged: this is short <em>volume</em> (incl. market-maker
          hedging), <strong>not short interest</strong> — free historical short-interest doesn&apos;t exist, so it&apos;s the closest free proxy.</p>
          <div className="text-xs text-emerald-400 mt-3 group-hover:underline">Try it →</div>
        </a>

        <a href="/quality" className="group block border border-zinc-800 rounded-md p-5 hover:border-emerald-700 hover:bg-emerald-950/10 transition-colors md:col-span-2">
          <div className="flex items-baseline gap-2"><h2 className="text-lg font-semibold">Task 17</h2>
            <span className="text-xs text-zinc-500 uppercase tracking-wider">Fundamental Quality (XBRL)</span></div>
          <p className="text-sm text-zinc-400 mt-2 leading-relaxed">Three classic free quality factors from SEC XBRL —
          Piotroski <span className="text-blue-400">F-Score</span>, Sloan <span className="text-amber-400">accruals</span>
          (earnings quality), and the <span className="text-amber-400">asset-growth</span> anomaly — point-in-time, filing-date
          keyed; the LLM picks the factor or a composite. Numbers, where T3 reads the 10-K text.</p>
          <div className="text-xs text-emerald-400 mt-3 group-hover:underline">Try it →</div>
        </a>
        <a href="/events" className="group block border border-zinc-800 rounded-md p-5 hover:border-emerald-700 hover:bg-emerald-950/10 transition-colors md:col-span-2">
          <div className="flex items-baseline gap-2"><h2 className="text-lg font-semibold">Task 18</h2>
            <span className="text-xs text-zinc-500 uppercase tracking-wider">Corporate Events (8-K / 13D)</span></div>
          <p className="text-sm text-zinc-400 mt-2 leading-relaxed"><span className="text-emerald-400">Schedule 13D</span> activist
          stakes (positive drift) + <span className="text-amber-400">red flags</span> (dilution, late filings, auditor changes,
          delisting, adverse <span className="text-amber-400">8-K 5.02</span> exec departures the LLM reads from the text). Keyed off
          the filing date; ride activist drift, stand aside on red flags.</p>
          <div className="text-xs text-emerald-400 mt-3 group-hover:underline">Try it →</div>
        </a>
        <a href="/anomaly" className="group block border border-zinc-800 rounded-md p-5 hover:border-emerald-700 hover:bg-emerald-950/10 transition-colors md:col-span-2">
          <div className="flex items-baseline gap-2"><h2 className="text-lg font-semibold">Task 19</h2>
            <span className="text-xs text-zinc-500 uppercase tracking-wider">Price Anomalies</span></div>
          <p className="text-sm text-zinc-400 mt-2 leading-relaxed">Three documented price anomalies (prices only):
          <span className="text-amber-400"> 52-week-high momentum</span>, <span className="text-amber-400">MAX/lottery</span>
          avoidance, and <span className="text-amber-400">tax-loss reversal</span> (Jan effect). LLM picks one; trailing-window
          + calendar → lookahead-free.</p>
          <div className="text-xs text-emerald-400 mt-3 group-hover:underline">Try it →</div>
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
