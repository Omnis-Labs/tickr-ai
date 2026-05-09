# Dev Tools Privy Delegated Ultra Swap

This document covers the `/dev-tools` experiment for executing a synthetic Order from the server with Privy delegated wallet access and Jupiter Ultra. It is not the production trade flow.

## Scope

- Lives behind `/dev-tools` and `ENABLE_DEV_TOOLS=true`.
- Executes only owned Orders that came from `DEV_TOOLS` proposals.
- Uses Privy delegated wallet access and `PRIVY_WALLET_AUTHORIZATION_PRIVATE_KEY`.
- Leaves the production tap-to-execute `TriggerExecution` flow unchanged.

## Privy Setup

1. In the Privy dashboard, enable server-side access or signers for the app.
2. Enable signed requests.
3. Copy the generated P-256 signing private key into local `.env` as `PRIVY_WALLET_AUTHORIZATION_PRIVATE_KEY`.
4. Keep `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_ID`, and `PRIVY_APP_SECRET` configured.
5. Restart the web dev server after changing `.env`.

The key must be the base64 PKCS8 private key with no PEM headers. Do not commit a real value.

## First Swap Runbook

1. Start the app with dev tools enabled.
2. Open `/dev-tools`, unlock the dev-tools password, and sign in with Privy.
3. In **Delegated access**, click **Enable** and approve the Privy prompt.
4. Click **Check**. The block should show delegated access and server key configured.
5. Fund the embedded Solana wallet with enough USDC for a BUY test, or enough token balance for a SELL test.
6. Generate and accept a dev-tools proposal to create a BUY trigger Order, or pick an existing open TP/SL Order.
7. In **Privy delegated Ultra swap**, select the exact open Order to execute.
8. Click **Execute swap**. The server will claim the Order, request a Jupiter Ultra order, ask Privy to sign with the server authorization key, submit `/execute`, and settle the DB lifecycle.

## Expected Failures

- `missing_privy_authorization_private_key`: add `PRIVY_WALLET_AUTHORIZATION_PRIVATE_KEY`.
- `wallet_not_delegated`: click **Enable** in the Delegated access block and approve Privy.
- `insufficient_funds`: fund the wallet with the input mint for the selected Order.
- `ultra_order_unavailable`: Jupiter did not return a usable unsigned transaction.
- `jupiter_ultra_execute_failed`: Jupiter rejected the signed transaction.

When debugging, use the `/dev-tools` logs. The delegated access log reports configuration readiness. The delegated Ultra swap log reports wallet delegation, server signer, Ultra relay, signature, and settlement details.
