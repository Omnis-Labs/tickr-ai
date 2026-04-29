// Auto TP/SL placement on BUY fill — Phase F's main payoff for delegated
// signing. When a BUY_TRIGGER fills, we already know the user's preferred
// TP/SL prices (set when they approved the proposal), so we can place
// both legs without prompting them, by signing each Jupiter trigger
// order server-side via the Privy server SDK.
//
// Falls back silently if delegation isn't configured or the user hasn't
// granted it — in that case the existing client-side flow on the
// Position Detail page kicks in (state=ENTERING surfaces the manual
// "Confirm exits" CTA).
//
// Mirrors the pattern in oco.ts: initiate → sign delegated → confirm,
// then create the Order row so /api/orders + the desk widgets see it.

import type { PrismaClient } from '@hunch-it/db';
import { Prisma } from '@prisma/client';
import {
  JUPITER_TRIGGER_DEPOSIT_CRAFT,
  JUPITER_TRIGGER_ORDERS_PRICE,
  JUPITER_TRIGGER_VAULT,
  USDC_MINT,
  getAssetById,
} from '@hunch-it/shared';
import { isDelegationConfigured, signTransactionDelegated } from '../../privy/index.js';
import { jupiterUrl } from './jupiter-history.js';

interface AutoExitInput {
  prisma: PrismaClient;
  positionId: string;
  userId: string;
  walletAddress: string;
  privyWalletId: string;
  ticker: string; // e.g. AAPLx
  tokenAmount: number; // total BUY-filled amount; we split evenly across legs
}

interface PlaceLegInput {
  walletAddress: string;
  privyWalletId: string;
  vault: string;
  inputMint: string;
  inputDecimals: number;
  tokenAmount: number;
  triggerPriceUsd: number;
  triggerCondition: 'above' | 'below';
}

const SLIPPAGE_BPS = 50;
// 7-day expiry — Jupiter requires an explicit cutoff. Long enough for
// the position to actually run; the user can cancel/edit anytime.
const EXPIRY_SECONDS = 7 * 24 * 3600;

async function getOrCreateVault(walletAddress: string): Promise<string | null> {
  try {
    const url = `${jupiterUrl(JUPITER_TRIGGER_VAULT)}?wallet=${encodeURIComponent(walletAddress)}`;
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const j = (await res.json()) as { vault?: string };
    return j.vault ?? null;
  } catch {
    return null;
  }
}

async function placeLegDelegated(p: PlaceLegInput): Promise<string | null> {
  const inputAmountSmallest = Math.floor(p.tokenAmount * 10 ** p.inputDecimals).toString();

  const craftRes = await fetch(jupiterUrl(JUPITER_TRIGGER_DEPOSIT_CRAFT), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      wallet: p.walletAddress,
      vault: p.vault,
      mint: p.inputMint,
      amount: inputAmountSmallest,
    }),
  });
  if (!craftRes.ok) return null;
  const craftJson = (await craftRes.json()) as { transaction?: string };
  if (!craftJson.transaction) return null;

  const signed = await signTransactionDelegated({
    privyWalletId: p.privyWalletId,
    transactionBase64: craftJson.transaction,
  });
  if (!signed) return null;

  const placeRes = await fetch(jupiterUrl(JUPITER_TRIGGER_ORDERS_PRICE), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      vault: p.vault,
      signedDepositTransaction: signed,
      inputMint: p.inputMint,
      outputMint: USDC_MINT,
      inputAmount: inputAmountSmallest,
      triggerPriceUsd: p.triggerPriceUsd,
      triggerCondition: p.triggerCondition,
      slippageBps: SLIPPAGE_BPS,
      expiresAt: Math.floor(Date.now() / 1000) + EXPIRY_SECONDS,
    }),
  });
  if (!placeRes.ok) return null;
  const placeJson = (await placeRes.json()) as { id?: string };
  return placeJson.id ?? null;
}

/**
 * Try to place TP + SL trigger orders for a freshly-filled BUY position.
 * Returns the count of legs successfully placed (0, 1, or 2). Failures
 * are swallowed: caller falls back to the existing user-prompted flow.
 *
 * Idempotent: skips legs that already have an OPEN Order row, so reruns
 * (e.g. tracker poll vs. socket fill) are safe.
 */
export async function tryAutoPlaceExits(input: AutoExitInput): Promise<number> {
  if (!isDelegationConfigured()) return 0;

  const position = await input.prisma.position.findUnique({
    where: { id: input.positionId },
    select: { currentTpPrice: true, currentSlPrice: true },
  });
  const tp = position?.currentTpPrice?.toNumber() ?? null;
  const sl = position?.currentSlPrice?.toNumber() ?? null;
  if (tp == null && sl == null) return 0;

  const existing = await input.prisma.order.findMany({
    where: {
      positionId: input.positionId,
      kind: { in: ['TAKE_PROFIT', 'STOP_LOSS'] },
      status: { in: ['OPEN', 'PARTIALLY_FILLED'] },
    },
    select: { kind: true },
  });
  const haveTp = existing.some((o) => o.kind === 'TAKE_PROFIT');
  const haveSl = existing.some((o) => o.kind === 'STOP_LOSS');
  const needTp = tp != null && !haveTp;
  const needSl = sl != null && !haveSl;
  if (!needTp && !needSl) return 0;

  const asset = getAssetById(input.ticker);
  if (!asset?.mint) {
    console.warn(`[auto-exit] no mint configured for ${input.ticker}`);
    return 0;
  }

  const vault = await getOrCreateVault(input.walletAddress);
  if (!vault) return 0;

  // Split the position evenly across both legs when both prices are set;
  // otherwise the lone leg gets the full amount.
  const haveBoth = needTp && needSl;
  const tpAmount = needTp ? (haveBoth ? input.tokenAmount / 2 : input.tokenAmount) : 0;
  const slAmount = needSl ? (haveBoth ? input.tokenAmount / 2 : input.tokenAmount) : 0;

  const baseLeg = {
    walletAddress: input.walletAddress,
    privyWalletId: input.privyWalletId,
    vault,
    inputMint: asset.mint,
    inputDecimals: asset.decimals,
  };

  let placed = 0;

  if (needTp && tp != null) {
    try {
      const jupId = await placeLegDelegated({
        ...baseLeg,
        tokenAmount: tpAmount,
        triggerPriceUsd: tp,
        triggerCondition: 'above',
      });
      if (jupId) {
        await input.prisma.order.create({
          data: {
            userId: input.userId,
            positionId: input.positionId,
            kind: 'TAKE_PROFIT',
            side: 'SELL',
            status: 'OPEN',
            jupiterOrderId: jupId,
            triggerPriceUsd: new Prisma.Decimal(tp),
            sizeUsd: new Prisma.Decimal(tpAmount * tp),
            tokenAmount: new Prisma.Decimal(tpAmount),
          },
        });
        placed += 1;
      }
    } catch (err) {
      console.warn('[auto-exit] TP placement failed', err);
    }
  }

  if (needSl && sl != null) {
    try {
      const jupId = await placeLegDelegated({
        ...baseLeg,
        tokenAmount: slAmount,
        triggerPriceUsd: sl,
        triggerCondition: 'below',
      });
      if (jupId) {
        await input.prisma.order.create({
          data: {
            userId: input.userId,
            positionId: input.positionId,
            kind: 'STOP_LOSS',
            side: 'SELL',
            status: 'OPEN',
            jupiterOrderId: jupId,
            triggerPriceUsd: new Prisma.Decimal(sl),
            sizeUsd: new Prisma.Decimal(slAmount * sl),
            tokenAmount: new Prisma.Decimal(slAmount),
          },
        });
        placed += 1;
      }
    } catch (err) {
      console.warn('[auto-exit] SL placement failed', err);
    }
  }

  if (placed > 0) {
    await input.prisma.position.update({
      where: { id: input.positionId },
      data: { state: 'ACTIVE' },
    });
  }

  return placed;
}
