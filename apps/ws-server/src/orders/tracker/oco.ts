// OCO sibling cancel — when one leg of the TP/SL pair fills, the other leg
// must be cancelled to release vault funds. Phase F: when the user opted into
// delegated signing, we run the cancel flow server-side via the Privy server
// SDK; otherwise the caller emits position:updated action=cancel-sibling so
// the frontend can prompt the user to sign.

import type { PrismaClient } from '@hunch-it/db';
import { isDelegationConfigured, signTransactionDelegated } from '../../privy/index.js';
import {
  JUPITER_CANCEL_CONFIRM,
  JUPITER_CANCEL_INITIATE,
  jupiterUrl,
} from './jupiter-history.js';

/**
 * Attempt a server-side delegated cancel via Privy. Returns true if the
 * cancel was submitted on-chain and our Order row was marked CANCELLED.
 * Returns false on any failure (no SDK, no creds, Jupiter rejection, etc.)
 * — caller should fall back to the user-prompted banner.
 */
export async function tryDelegatedCancel(
  prisma: PrismaClient,
  jupiterOrderId: string,
  privyWalletId: string,
): Promise<boolean> {
  if (!isDelegationConfigured()) return false;
  try {
    const initiateRes = await fetch(jupiterUrl(JUPITER_CANCEL_INITIATE), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId: jupiterOrderId }),
    });
    if (!initiateRes.ok) return false;
    const initiateJson = (await initiateRes.json()) as { transaction?: string };
    if (!initiateJson.transaction) return false;

    const signed = await signTransactionDelegated({
      privyWalletId,
      transactionBase64: initiateJson.transaction,
    });
    if (!signed) return false;

    const confirmRes = await fetch(jupiterUrl(JUPITER_CANCEL_CONFIRM), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orderId: jupiterOrderId,
        signedWithdrawalTx: signed,
      }),
    });
    if (!confirmRes.ok) return false;

    const order = await prisma.order.findFirst({
      where: { jupiterOrderId },
      select: { id: true },
    });
    if (order) {
      await prisma.order.update({
        where: { id: order.id },
        data: { status: 'CANCELLED' },
      });
    }
    return true;
  } catch (err) {
    console.warn('[privy] delegated cancel failed', err);
    return false;
  }
}
