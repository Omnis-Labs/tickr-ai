# ADR-0002: Canonical asset ids and signal-data freshness

- **Status**: Accepted (2026-05-08)
- **Context**: The signal engine previously treated US equities as bare symbols internally and depended on US market-hours logic. Hunch now trades tokenized assets on Solana, so the product language, DB values, price feeds, charts, and proposal rules must use the tradable token asset as the source of truth.

## Decision

Hunch recognizes only canonical `AssetId` values from `packages/shared/src/assets.ts`.

- xStocks use their tokenized symbols: `AAPLx`, `NVDAx`, `TSLAx`, `SPYx`, `QQQx`, `GOOGLx`, `METAx`.
- Crypto uses the approved Jupiter-tradable ids: `wBTC`, `ETH`, `BNB`, `wXRP`, `TRX`, `HYPE`.
- `SOL` is wallet fee balance only, not a Position recommendation asset.
- `MSFTx` is removed from the supported universe until it has xStock-native Pyth signal data.

The canonical proposal rule is:

> Hunch may generate a proposal only when the asset's signal data is fresh for that asset class.

Freshness is data-driven. The signal engine checks the Pyth latest-price publish time with the existing staleness window. There is no US market-hours guardrail and no proposal expiry shortening when US equities close.

## Consequences

- Bare equity symbols are not valid Hunch asset identifiers.
- Pyth adapters use asset registry metadata (`pythFeedId`, `pythSymbol`) instead of building provider symbols from bare tickers.
- xStock signals and charts use xStock-native Pyth symbols such as `Crypto.AAPLX/USD`; they must not fall back to underlying equity feeds.
- Proposal, Position, Order, and Trade `ticker` columns retain their column name for migration safety, but values are `AssetId`.
- Dev-tools, docs, feed snapshots, verifier inputs, and smoke tests use the same asset ids as production.
- Adding a new tradable asset requires a Jupiter-tradable mint and a configured Pyth latest-price plus benchmark-bars source.

