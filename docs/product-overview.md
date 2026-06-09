# Hunch It — Product Overview

> Gen Z already invests by vibe. Hunch It turns each vibe trade into a disciplined proposal.
>
> Hunch It helps Gen Z investors turn trade ideas from friends, creators, social feeds, or market moves into disciplined trade proposals using AI analysts they choose for their style.
>
> Domain: app domain | alpha

---

## What Hunch It Does

Hunch It turns "should I follow this trade idea?" into a disciplined proposal the user can review, edit, approve, or skip.

It works in two ways:

1. Users can bring trade ideas from friends, creators, or social feeds and have them vetted by AI analysts they choose.
2. Users can choose AI analysts that watch the market and send new proposals.

Both paths end in one disciplined proposal the user controls.

Every proposal should answer:

- What is the thesis?
- Why now?
- What is the entry or trigger?
- How big should the position be?
- Where should the user take profit?
- Where should the user cut the loss?
- What would make the trade wrong?

## Current Product Status

Hunch It is an alpha PWA with Privy auth, embedded Solana wallet support, synthetic-trigger execution, and proposal review flows. The current signed-in navigation is Home, Grill, Team, and Portfolio, with Settings, Proposal Detail, Position Detail, Withdraw, and `/dev-tools` available from those flows.

The current product has two proposal paths:

1. **Grill:** the user chooses a supported asset, pastes a trade idea from a friend, creator, social feed, or market move, and runs the selected AI Trading Team against it. Grill shows each Analyst Opinion, then can create one BUY Proposal with `origin = GRILL`.
2. **Market watch:** the ws-server can scan supported markets, build Base Market Analysis, and fan out BUY Proposals to eligible users. This is currently opt-in with `ENABLE_SIGNAL_LOOP=true`.

Mandate setup remains required. It supplies the user's holding period, max drawdown, max trade size, and market focus for sizing and risk controls. The AI Trading Team lives alongside the Mandate as a product preference.

## Core Loop

```text
Login → Mandate Setup → Home / Grill / Team
  → Review disciplined BUY Proposal
  → Approve synthetic BUY trigger Order or Skip
  → ws-server waits for executable trigger
    → Auto-execute triggers fills through delegated Privy signer access, or
    → trigger:hit toast lets the user tap Execute
  → BUY fill activates Position and arms TP/SL synthetic Orders
  → TP/SL, manual close, or skip/ignore resolves the strategy
```

## Current Scope

### What We Build

- **PWA** with Next.js App Router, manifest, and service worker.
- **Privy auth** with email / Google / Apple / external wallet support and auto-created embedded Solana wallet.
- **AI Trading Team** selection of up to six AI Analysts. Current selection is stored in browser local storage.
- **Grill** for user-supplied trade ideas and visible Analyst Opinions.
- **Home / Desk** for portfolio summary, proposal feed, open synthetic Orders, and deposit prompts.
- **Proposal Detail** for reviewing thesis, timing, entry/trigger, size, TP, SL, invalidation, and position impact.
- **Synthetic trigger execution** through DB Orders, Pyth wake-up checks, Jupiter Ultra executable quotes, tap-to-execute fallback, and opt-in Auto-execute triggers.
- **Automatic TP/SL** after BUY fills, with OCO sibling cancellation when an exit fills.
- **Signal Engine** in `apps/ws-server`: trigger monitoring is always on; live proposal generation, back-evaluation, and thesis monitoring are env-gated.
- **Price charts** from Pyth Benchmarks historical data.
- **PostgreSQL** for mandates, proposals, positions, orders, trades, and skips.

### Supported Proposal Assets

USDC is the base currency. All prices, trades, and P&L are denominated in USDC.

Current supported proposal assets are:

- xStocks / tokenized ETF xStocks: `AAPLx`, `NVDAx`, `TSLAx`, `SPYx`, `QQQx`, `GOOGLx`, `METAx`
- Crypto: `wBTC`, `ETH`, `BNB`, `wXRP`, `TRX`, `HYPE`

`SOL` is wallet fee balance only. Hunch It does not recommend it as a Position.

### What We Explicitly Exclude

| Item                                   | Reason                                                                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Manual trading                         | Trades originate from proposals. This is the product differentiator.                                                    |
| Custodial execution                    | Hunch It does not custody assets or place external trigger orders.                                                      |
| External conditional order APIs        | Runtime uses synthetic DB Orders plus Jupiter Ultra swaps.                                                              |
| Partial sells                          | v1 simplification: exits close the full Position.                                                                       |
| Fiat onramp                            | Users must bring their own USDC on Solana.                                                                              |
| Remote push notifications              | Current notifications are in-session browser notifications only.                                                        |
| Server-persisted AI Trading Team       | Current Team selection is a browser preference.                                                                         |
| Fully autonomous discretionary trading | Auto-execute triggers only executes user-approved synthetic Orders; users still approve the original disciplined setup. |
| Life Credit / borrowing                | Future product area.                                                                                                    |
| Integrator swap fees                   | Future product area.                                                                                                    |
| Multi-language                         | English only.                                                                                                           |

## MWP Completeness Checklist

- [x] User understands the product promise before logging in.
- [x] User can log in and receive a Solana wallet.
- [x] User can create a Mandate.
- [x] User can select an AI Trading Team in the browser.
- [x] User can bring a trade idea to Grill and see Analyst Opinions.
- [x] Grill can create one BUY Proposal from a completed review.
- [x] Proposal Detail shows editable size, trigger, TP, and SL.
- [x] User can approve a synthetic BUY trigger Order.
- [x] User can skip a proposal.
- [x] Trigger monitor checks Pyth and confirms executable price with Jupiter Ultra.
- [x] Tap-to-execute fallback can fill a trigger through Jupiter Ultra.
- [x] Auto-execute triggers can fill BUY/TP/SL triggers when Privy delegation is live.
- [x] BUY fill creates automatic TP/SL synthetic exit Orders.
- [x] TP/SL fill cancels the sibling Order and closes the Position.
- [x] User can manually Close Position.
- [x] User can cancel a BUY pending Order.
- [x] Portfolio shows cash, holdings, realized P&L, and unrealized P&L.
- [ ] Server-persisted AI Trading Team preferences.
- [ ] Market-watch proposal generation enabled by default.
- [ ] Production readiness beyond small real-fund testing.
