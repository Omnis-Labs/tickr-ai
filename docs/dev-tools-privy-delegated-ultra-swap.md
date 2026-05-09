# Dev Tools Privy Delegated Ultra Swap

This document covers the `/dev-tools` harness for executing a synthetic Order from the server with Privy wallet v2 signer access and Jupiter Ultra. `/dev-tools` wraps the same `@hunch-it/execution` Delegated Execution Runtime used by production Auto-execute triggers, adding diagnostic capture around the concrete adapters.

## Scope

- Lives behind `/dev-tools` and `ENABLE_DEV_TOOLS=true`.
- Executes only owned Orders that came from `DEV_TOOLS` proposals.
- Uses Privy wallet v2 signer access and `PRIVY_WALLET_AUTHORIZATION_PRIVATE_KEY`.
- Exercises the same delegated Ultra Module that production ws-server uses when a trigger hits and the wallet is delegated.

## Privy Setup

1. In the Privy dashboard, enable wallet v2 signers for the app.
2. Enable signed requests.
3. Copy the generated P-256 signing private key into local `.env` as `PRIVY_WALLET_AUTHORIZATION_PRIVATE_KEY`.
4. Copy the key quorum/signer ID into local `.env` as both `PRIVY_WALLET_AUTHORIZATION_SIGNER_ID` and `NEXT_PUBLIC_PRIVY_WALLET_AUTHORIZATION_SIGNER_ID`.
5. If your signer requires policies, set `NEXT_PUBLIC_PRIVY_WALLET_AUTHORIZATION_POLICY_IDS` to the comma-separated policy IDs.
6. Keep `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_ID`, and `PRIVY_APP_SECRET` configured.
7. Restart the web dev server after changing `.env`.

The private key must be the base64 PKCS8 private key with no PEM headers. Do not commit a real value.
The signer ID is not secret, but it must match the private key's registered key quorum.

## First Swap Runbook

1. Start the app with dev tools enabled.
2. Open `/dev-tools`, unlock the dev-tools password, and sign in with Privy.
3. In **Delegated access**, click **Enable** and approve the Privy prompt.
4. Click **Check**. The block should show delegated access and server key configured.
5. Fund the embedded Solana wallet with enough USDC for a BUY test, or enough token balance for a SELL test.
6. Generate and accept a dev-tools proposal to create a BUY trigger Order, or pick an existing open TP/SL Order.
7. In **Privy delegated Ultra swap**, select the exact open Order to execute.
8. Read **Preflight hypotheses**. It should say **Can attempt** before the real swap path runs.
9. Click **Execute swap**. The server will first write a `privyDelegatedUltraSwap.preflight` log, then call the shared Delegated Execution Runtime. The harness records the resolved wallet, prepared amount, Jupiter Ultra order, delegated signature, `/execute` response, and settlement outcome around that production path.

## Debug Logs

The `/dev-tools` block now shows the likely failure points before execution:

- **Wallet session**: whether the embedded Solana wallet is connected.
- **Selected order**: whether the order is open and supported by the delegated experiment.
- **Order funding**: the input mint and amount the wallet must hold.
- **Server readiness**: `PRIVY_WALLET_AUTHORIZATION_PRIVATE_KEY`, Privy wallet lookup, and delegation blockers.
- **Privy delegation**: whether the client and server agree that delegated access is enabled.
- **Ultra order transaction**: whether Jupiter can return a non-empty signable transaction.
- **Privy signing**: whether the server key is present and likely able to sign through the delegated policy.
- **Order settlement**: whether DB settlement may conflict with a concurrently claimed, filled, or cancelled order.

Clicking **Execute swap** is allowed even when preflight is blocked. In that case it records a failed `privyDelegatedUltraSwap.preflight` log with the blockers, but it does not post the swap execution request.

## Expected Failures

- `missing_privy_authorization_private_key`: add `PRIVY_WALLET_AUTHORIZATION_PRIVATE_KEY`.
- `missing_privy_authorization_signer_id`: add `PRIVY_WALLET_AUTHORIZATION_SIGNER_ID` and `NEXT_PUBLIC_PRIVY_WALLET_AUTHORIZATION_SIGNER_ID`.
- `unsupported_privy_wallet_client_type`: use a Privy wallet v2 embedded Solana wallet; legacy Privy wallet delegation is not supported in the current dev phase.
- `wallet_missing_authorization_signer`: click **Enable** again and approve the Privy signer delegation prompt.
- `wallet_not_delegated`: click **Enable** in the Delegated access block and approve Privy.
- `insufficient_funds`: fund the wallet with the input mint for the selected Order.
- `ultra_order_unavailable`: Jupiter did not return a usable unsigned transaction.
- `delegated_order_or_sign_runtime_error`: Jupiter Ultra `/order`, transaction decoding, or Privy signing failed before `/execute`; the claim is released when one was acquired.
- `delegated_execute_signature_unknown`: Jupiter Ultra `/execute` was attempted but no signature was returned; the claim is retained for reconciliation.
- `delegated_settlement_runtime_error`: Jupiter returned a signature, but settlement threw before the response could be completed.
- `settle_*`: PositionLifecycle rejected settlement after a signature was known.

When debugging, use the `/dev-tools` logs. The delegated access log reports configuration readiness. The delegated Ultra swap log reports wallet delegation, server signer, Ultra relay, signature, and settlement details.
