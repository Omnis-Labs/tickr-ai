# Fama–French 5-factor (+ momentum) alpha

> **Method.** For each placebo control we regress its **active daily return** — strategy minus
> buy-and-hold of the *same* stock — on the Fama–French 5 factors (Mkt-RF, SMB, HML, RMW, CMA) plus
> momentum (MOM). The intercept α is the divination **timing overlay's** factor-adjusted alpha; the
> t-stat says whether it's real. Differencing against buy-and-hold strips the host stock's
> idiosyncratic drift (which FF factors don't span and would otherwise masquerade as "alpha"),
> leaving only the timing decision — exactly what we want to test. Factors from the Ken French Data
> Library; OLS with classical t-stats.

## Result: zero positive factor-alpha

| Window | n regressions | median α t-stat | median ann. α | \|t\|>2: **positive** / negative |
|---|--:|--:|--:|--:|
| **2023–26 bull** | 348 | **−1.07** | **−7.5%/yr** | **0** / 54 |
| **2022 bear** | 348 | −0.78 | −3.0%/yr | 1 / 16 |

**Not one** placebo timing overlay shows a significantly **positive** FF5+MOM alpha in the bull
(1/348 in the bear — the ~0.3% you'd get by chance). After controlling for market, size, value,
profitability, investment and momentum, the divination timing adds **no real alpha** — and in the
bull it's a **factor-adjusted drag of −7.5%/yr**, because every day spent sitting out of a rising
market forfeits the premium even after the factor adjustment. (The 54 significantly-negative cases
are the same mechanism the alpha-vs-SPY −58% and the "reverse it?" experiment surfaced — now
confirmed to survive a full six-factor control.)

## The pitch takeaway

> *"We measure alpha the way an allocator does — the intercept of a Fama-French 5-factor + momentum
> regression, with a t-stat — not a raw return. Run it on our placebo timing rules and **zero of 348
> clear a positive t>2**; the timing is a −7.5%/yr drag once you net out the known factors. A real
> agent has to post a positive, significant factor-alpha to matter, and the same regression takes any
> agent's return stream as a drop-in."*

This is the institutional-language benchmark: it reframes "did it beat the market?" as "did it beat
the market *after* you account for the factors any cheap ETF already sells?" — the bar that separates
alpha from repackaged beta.

---
*Reproduce:* `python tools/fama_french.py` (bull) / `--start 2022-01-01 --end 2022-12-31` (bear).
*Artifacts: `shared/reports/fama_french.json`, `…_2022bear.json`; factors cached in
`shared/reports/ff_factors_daily.json` (Ken French Data Library, public domain).*
