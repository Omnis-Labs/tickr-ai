# Hunch — Product Overview

> AI trading signals with one-tap execution for tokenized stocks & crypto on Solana. Users define an investment mandate, receive personalized BUY proposals (with take-profit and stop-loss), execute via Jupiter Trigger Orders, and get automatic exit protection on every position.
>
> Domain: <app-domain> | v1.3 | 2026-04-27

---

## What Hunch Does

Hunch turns market movements into clear, personalized, actionable trade proposals. Every proposal is tailored to the individual user's investment mandate and current portfolio. Users review, adjust parameters if needed, and execute with one tap. After a BUY order fills, the system automatically places take-profit and stop-loss orders to protect the position.

The entire experience runs as a PWA with an embedded Solana wallet (via Privy). No app store download, no external wallet setup required.

## The Core Loop

```
Login → Mandate Setup → Home → Review BUY Proposal → Place Order
→ BUY Fills → TP/SL Auto-Protected → Adjust TP/SL or Close Position
```

## Minimum Wowable Product (MWP) Definition

Hunch's MWP proves one promise: **a user sets their investment mandate, deposits USDC, and Hunch converts market events combined with the user's actual portfolio into a clear, personalized, immediately executable BUY proposal that automatically protects the position after entry.**

### Four conditions that must be true

1. **Proposals are personalized.** They reference the user's mandate, cash balance, existing positions, P&L, and sector exposure. Alice and Bob receive different proposals for the same stock.

2. **Proposals are actionable.** Each proposal includes: asset, suggested size, trigger price, take-profit price, stop-loss price, expiry, and three-part reasoning (what changed, why this trade, why it fits your mandate). Users can adjust parameters before executing.

3. **Execution has built-in protection.** After a BUY fills, the system automatically places TP and SL trigger orders. One-Cancels-Other (OCO) behavior: when one side fills, the system cancels the other.

4. **The trust path is complete.** Users always know: where their funds are (wallet vs. Jupiter vault), what state each order is in, and what state each position is in.

---

## Scope

### What We Build

- **PWA** (single interface with manifest + service worker, no native app)
- **Privy auth** (email / Google / Apple / external wallet) with auto-created embedded Solana wallet
- **4 core trading screens** (Mandate Setup → Home → Proposal Detail → Position Detail) plus Landing/Login and Settings
- **Trigger-based limit order execution** via Jupiter Trigger Order API v2
- **Automatic TP/SL**: system places exit orders after BUY fills, with OCO behavior
- **Signal Engine**: independent backend (ws-server) using Pyth price feeds + technical indicators + Claude Sonnet/Opus LLM to generate personalized BUY proposals per user mandate
- **Price charts**: Pyth Benchmarks historical data + Lightweight Charts rendering
- **GCP Cloud SQL** (PostgreSQL) for persistence: mandates, positions, proposals, trades, orders
- **Supported assets**: Jupiter-listed xStocks + bluechip crypto (SOL, BTC, ETH)
- **Back-evaluation**: automated proposal quality scoring 1 hour after generation

### What We Explicitly Exclude

| Item                                   | Reason                                                                                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manual trading                         | All trades originate from proposals. This is the product differentiator.                                                                                            |
| SELL proposals                         | Sells happen via TP/SL auto-triggers or user-initiated Close Position.                                                                                              |
| Partial sells                          | v1 simplification: SELL always closes the full position.                                                                                                            |
| Life Credit (borrow against positions) | v2                                                                                                                                                                  |
| Integrator swap fees                   | v2                                                                                                                                                                  |
| Remote push notifications              | PWA web push is unreliable on iOS. In-session browser desktop notifications (via HTML5 Notification API) ARE included when the app has an active tab/Shared Worker. |
| Fiat onramp                            | Users must bring their own USDC on Solana                                                                                                                           |
| Gas sponsoring                         | Users must bring their own SOL                                                                                                                                      |
| Historical performance charts          | v1 shows current state only                                                                                                                                         |
| Multi-language                         | English only                                                                                                                                                        |
| Leaderboard                            | v2                                                                                                                                                                  |
| Redis cache layer                      | PostgreSQL only                                                                                                                                                     |

---

## Supported Assets

USDC is the base currency. All prices, trades, and P&L are denominated in USDC.

### Tokenized Stocks (xStocks)

Issued by Backed Finance, traded via Jupiter on Solana.

### Tokenized ETFs

### Bluechip Crypto

| Token | Solana Representation      |
| ----- | -------------------------- |
| SOL   | Native                     |
| BTC   | cbBTC or wBTC              |
| ETH   | wETH (Wormhole)            |
| USDC  | Native SPL (base currency) |

---

## MWP Completeness Checklist

- [ ] User understands the product promise before logging in
- [ ] User can log in and receive a Solana wallet
- [ ] User can create a mandate
- [ ] User can edit their mandate later
- [ ] Home clearly shows deposit status
- [ ] Home clearly shows portfolio state
- [ ] Hunch generates at least one personalized BUY proposal that references mandate + portfolio
- [ ] Proposal Detail explains the recommendation in user-specific terms
- [ ] Proposal includes TP/SL exit conditions
- [ ] User can adjust size, trigger price, TP, SL
- [ ] User can skip and provide a reason
- [ ] User can place a Jupiter Trigger Order
- [ ] BUY fill triggers automatic TP/SL placement
- [ ] TP/SL fill triggers automatic cancellation of the other side (OCO)
- [ ] User can adjust TP/SL on Position Detail
- [ ] User can manually Close Position (market price, full sell)
- [ ] User can cancel a BUY pending order
- [ ] Open Orders shows all pending orders (BUY / TP / SL)
- [ ] User always sees order status
- [ ] Portfolio updates after order fills
- [ ] Mandate change invalidates old proposals
- [ ] Error handling never creates a dead end
