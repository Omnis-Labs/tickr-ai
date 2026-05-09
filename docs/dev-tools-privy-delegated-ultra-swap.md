# Dev Tools Privy Delegated Ultra Swap

This document covers the `/dev-tools` harness for executing a synthetic Order from the server with Privy delegated wallet access and Jupiter Ultra. The same delegated execution primitives now power production Auto-execute triggers; `/dev-tools` remains the deterministic local diagnostic surface.

## Scope

- Lives behind `/dev-tools` and `ENABLE_DEV_TOOLS=true`.
- Executes only owned Orders that came from `DEV_TOOLS` proposals.
- Uses Privy delegated wallet access and `PRIVY_WALLET_AUTHORIZATION_PRIVATE_KEY`.
- Exercises the same delegated Ultra shape that production ws-server uses when a trigger hits and the wallet is delegated.

## Privy Setup

1. In the Privy dashboard, enable server-side access or signers for the app.
2. Enable signed requests.
3. Copy the generated P-256 signing private key into local `.env` as `PRIVY_WALLET_AUTHORIZATION_PRIVATE_KEY`.
4. Copy the key quorum/signer ID into local `.env` as `NEXT_PUBLIC_PRIVY_WALLET_AUTHORIZATION_SIGNER_ID`.
5. Keep `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_ID`, and `PRIVY_APP_SECRET` configured.
6. Restart the web dev server after changing `.env`.

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
9. Click **Execute swap**. The server will first write a `privyDelegatedUltraSwap.preflight` log, then claim the Order, request a Jupiter Ultra order, ask Privy to sign with the server authorization key, submit `/execute`, and settle the DB lifecycle.

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
- `missing_privy_authorization_signer_id`: add `NEXT_PUBLIC_PRIVY_WALLET_AUTHORIZATION_SIGNER_ID`.
- `wallet_missing_authorization_signer`: click **Enable** again and approve the Privy signer delegation prompt.
- `wallet_not_delegated`: click **Enable** in the Delegated access block and approve Privy.
- `insufficient_funds`: fund the wallet with the input mint for the selected Order.
- `jupiter_ultra_order_failed`: the server could not fetch a Jupiter Ultra order.
- `ultra_order_unavailable`: Jupiter did not return a usable unsigned transaction.
- `ultra_transaction_deserialize_failed`: Jupiter returned transaction bytes that Solana web3.js could not decode.
- `privy_sign_transaction_failed`: Privy could not sign with the server authorization key.
- `privy_signed_transaction_invalid`: Privy returned signed bytes that could not be decoded.
- `jupiter_ultra_execute_failed`: Jupiter rejected the signed transaction.
- `order_settlement_failed`: swap broadcast may have succeeded, but DB settlement failed.

When debugging, use the `/dev-tools` logs. The delegated access log reports configuration readiness. The delegated Ultra swap log reports wallet delegation, server signer, Ultra relay, signature, and settlement details.
