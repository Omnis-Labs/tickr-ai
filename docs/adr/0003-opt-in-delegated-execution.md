# ADR-0003: Opt-in delegated execution

- **Status**: Accepted (2026-05-09)
- **Revises**: ADR-0001 for users who have granted Privy wallet v2 signer access.

## Context

ADR-0001 froze Hunch on Synthetic Orders plus tap-to-execute because the product did not yet have a proven, non-custodial server-side signing path. The Privy delegated Ultra swap experiment has now proven that Hunch can execute a Jupiter Ultra swap with Privy wallet v2 signer access while keeping PositionLifecycle as the owner of `Position` / `Order` / `Trade` state.

## Decision

Hunch supports opt-in **Delegated Execution** for triggered Synthetic Orders (`BUY_TRIGGER`, `TAKE_PROFIT`, `STOP_LOSS`). This integration targets Privy wallet v2 signer delegation only; legacy Privy delegated-wallet flows are out of scope for the current dev phase. Privy delegated signer status is the source of truth; Hunch does not persist a separate DB toggle. The Settings UI labels this **Auto-execute triggers** and enabling it grants delegated execution ability; disabling it revokes the delegated signer access.

When `apps/ws-server` detects a trigger hit, it tries Delegated Execution first. If delegated execution is unavailable or fails before `/execute` is attempted, Hunch falls back to the existing `trigger:hit` tap-to-execute prompt. If Jupiter Ultra `/execute` is attempted but no signature is returned, or if a returned signature cannot be settled into the DB, Hunch keeps the execution claim locked for reconciliation instead of offering an immediate retry because a second swap could double-fill. Successful delegated execution emits `trade:filled` as a status event instead of `trigger:hit` as an action prompt.

## Consequences

- Accepted BUY proposals still create a Synthetic Order first; no buy happens at proposal acceptance.
- Delegated Execution works even when the user has no browser tab open.
- Manual close and SELL proposal confirmation remain user-signed manual actions.
- ADR-0001 remains the fallback path for users without Privy wallet v2 signer access.
