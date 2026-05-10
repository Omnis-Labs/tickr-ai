# Hunch — Product Overview

> AI trading signals with synthetic trigger swaps for xStocks and crypto on Solana. Users define an investment mandate, receive personalized BUY proposals (with take-profit and stop-loss), execute trigger Orders through Jupiter Ultra with tap-to-execute or opt-in Auto-execute triggers, and get automatic exit protection on every position.
>
> Domain: app domain | v1.3 | 2026-04-27

---

## What Hunch Does

Hunch turns market movements into clear, personalized, actionable trade proposals. Every proposal is tailored to the individual user's investment mandate and current portfolio. Users review, adjust parameters if needed, then accept a synthetic Order. When price hits, they can execute with one tap or opt into non-custodial Auto-execute triggers. After a BUY order fills, the system automatically places take-profit and stop-loss orders to protect the position.

The entire experience runs as a PWA with an embedded Solana wallet (via Privy). No app store download, no external wallet setup required.

## The Core Loop

```
Login → Mandate Setup → Home → Review BUY Proposal → Accept Synthetic Order
→ Price Trigger → Auto-execute or Tap Execute → Jupiter Ultra /execute → TP/SL Protected
→ Adjust TP/SL or Close Position
```

## Minimum Wowable Product (MWP) Definition

Hunch's MWP proves one promise: **a user sets their investment mandate, deposits USDC, and Hunch converts market events combined with the user's actual portfolio into a clear, personalized, immediately executable BUY proposal that automatically protects the position after entry.**

### Four conditions that must be true

1. **Proposals are personalized.** They reference the user's mandate, cash balance, existing positions, P&L, and sector exposure. Alice and Bob can receive different proposals for the same asset.

2. **Proposals are actionable.** Each proposal includes: asset, suggested size, trigger price, take-profit price, stop-loss price, expiry, and three-part reasoning (what changed, why this trade, why it fits your mandate). Users can adjust parameters before executing.

3. **Execution has built-in protection.** After a BUY fills, the system automatically creates TP and SL synthetic exit Orders. One-Cancels-Other (OCO) behavior: when one side fills, the system cancels the other.

4. **The trust path is complete.** Users always know that funds stay in their wallet, Auto-execute triggers is a revocable delegated ability rather than custody, what state each synthetic Order is in, and what state each Position is in.

---

## Scope

### What We Build

- **PWA** (single interface with manifest + service worker, no native app)
- **Privy auth** (email / Google / Apple / external wallet) with auto-created embedded Solana wallet
- **4 core trading screens** (Mandate Setup → Home → Proposal Detail → Position Detail) plus Landing/Login and Settings
- **Synthetic trigger execution**: ws-server watches Pyth, then either auto-executes through Privy signer access or emits `trigger:hit` so the user can tap Execute to run the same Jupiter Ultra swap
- **Automatic TP/SL**: system creates synthetic exit Orders after BUY fills, with OCO behavior
- **Signal Engine**: independent backend (ws-server) using asset-native Pyth price feeds + technical indicators + Gemini to produce Base Market Analysis; shared ProposalCreation turns that into personalized BUY proposals per user mandate
- **Price charts**: Pyth Benchmarks historical data + Lightweight Charts rendering
- **PostgreSQL** for persistence: mandates, positions, proposals, trades, orders
- **Supported assets**: Jupiter-listed xStocks/tokenized ETFs + crypto (`wBTC`, `ETH`, `BNB`, `wXRP`, `TRX`, `HYPE`)
- **Back-evaluation**: automated proposal quality scoring 1 hour after generation

### What We Explicitly Exclude

| Item                                   | Reason                                                                                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manual trading                         | All trades originate from proposals. This is the product differentiator.                                                                                            |
| Autonomous selling                     | Thesis-invalidation and manual close stay user action. TP/SL can auto-execute only when the user has opted into Auto-execute triggers.                              |
| Partial sells                          | v1 simplification: SELL always closes the full position.                                                                                                            |
| Life Credit (borrow against positions) | v2                                                                                                                                                                  |
| Integrator swap fees                   | v2                                                                                                                                                                  |
| Remote push notifications              | PWA web push is unreliable on iOS. In-session browser desktop notifications (via HTML5 Notification API) ARE included when the app has an active tab/Shared Worker. |
| Fiat onramp                            | Users must bring their own USDC on Solana                                                                                                                           |
| Custodial execution                    | Hunch does not custody assets or run external trigger orders; delegated execution is Privy wallet access that users can revoke anytime                              |
| Historical performance charts          | v1 shows current state only                                                                                                                                         |
| Multi-language                         | English only                                                                                                                                                        |
| Leaderboard                            | v2                                                                                                                                                                  |
| External cache layer                   | PostgreSQL plus in-process runtime state only                                                                                                                       |

---

## Supported Assets

USDC is the base currency. All prices, trades, and P&L are denominated in USDC.

### xStocks

Issued by Backed Finance, traded via Jupiter on Solana. Hunch displays and stores the xStock symbol (`AAPLx`, `NVDAx`, etc.), not the underlying US equity ticker.

### Tokenized ETFs

Tokenized ETF xStocks follow the same `*x` convention (`SPYx`, `QQQx`).

### Crypto

| AssetId | Solana Representation      |
| ------- | -------------------------- |
| wBTC    | Wrapped BTC                |
| ETH     | Portal ETH                 |
| BNB     | Portal BNB                 |
| wXRP    | Wrapped XRP                |
| TRX     | TRX                        |
| HYPE    | HYPE                       |
| USDC    | Native SPL (base currency) |

`SOL` is wallet fee balance only. Hunch does not recommend it as a Position.

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
- [ ] User can accept a synthetic BUY trigger Order
- [ ] `trigger:hit` toast lets the user tap Execute when Auto-execute triggers is off or unavailable
- [ ] Auto-execute triggers can be enabled/revoked from Settings and fills BUY/TP/SL triggers without a browser tab open
- [ ] Jupiter Ultra `/order` + Privy user signature + `/execute` fills the BUY
- [ ] BUY fill creates automatic TP/SL synthetic exit Orders
- [ ] TP/SL fill triggers automatic cancellation of the other side (OCO)
- [ ] User can adjust TP/SL on Position Detail
- [ ] User can manually Close Position (market price, full sell)
- [ ] User can cancel a BUY pending order
- [ ] Open Orders shows all pending orders (BUY / TP / SL)
- [ ] User always sees order status
- [ ] Portfolio updates after order fills
- [ ] Mandate change invalidates old proposals
- [ ] Error handling never creates a dead end
