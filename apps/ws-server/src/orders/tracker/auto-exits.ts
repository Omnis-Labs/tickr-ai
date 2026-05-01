// Auto TP/SL placement on BUY fill — Phase F's main payoff for delegated
// signing. When a BUY_TRIGGER fills, we already know the user's preferred
// TP/SL prices (set when they approved the proposal), so we place a
// single OCO order server-side without prompting the user.
//
// v2 OCO is a single Jupiter order from their POV; in our DB we still
// keep two Order rows (TAKE_PROFIT + STOP_LOSS sharing the same
// jupiterOrderId) so existing UI / reporting code keeps working. The
// tracker uses jupiterOrderId match to mark the losing leg CANCELLED
// when the winning one fills.
//
// Falls back silently if any precondition is missing (delegation not
// configured, no privy wallet id, no Jupiter JWT cached on User row,
// vault setup fails). The Position stays at ENTERING and the user gets
// the manual "Confirm exits" CTA on Position Detail.

import type { PrismaClient } from '@hunch-it/db';
import { Prisma } from '@prisma/client';
import { USDC_MINT, getAssetById } from '@hunch-it/shared';
import { env } from '../../env.js';
import { isDelegationConfigured, signTransactionDelegated } from '../../privy/index.js';
import { jupiterUrl } from './jupiter-history.js';

interface AutoExitInput {
  prisma: PrismaClient;
  positionId: string;
  userId: string;
  walletAddress: string;
  privyWalletId: string;
  ticker: string;
  /** Total xStock balance acquired from the BUY. The OCO leg sells the
   *  whole position; whichever side fires first wins, the other gets
   *  cancelled by Jupiter natively. */
  tokenAmount: number;
}

const SLIPPAGE_BPS = 50;
const EXPIRY_MS = 7 * 24 * 3600 * 1000;

interface JwtBundle {
  jwt: string;
  apiKey: string;
}

async function authedJupiterFetch<T>(
  path: string,
  bundle: JwtBundle,
  init: { method?: 'GET' | 'POST' | 'PATCH'; body?: unknown } = {},
): Promise<T | null> {
  try {
    const res = await fetch(jupiterUrl(path), {
      method: init.method ?? 'GET',
      headers: {
        'x-api-key': bundle.apiKey,
        Authorization: `Bearer ${bundle.jwt}`,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        accept: 'application/json',
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(`[auto-exit] ${init.method ?? 'GET'} ${path} → ${res.status}: ${text.slice(0, 200)}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`[auto-exit] ${init.method ?? 'GET'} ${path} threw`, err);
    return null;
  }
}

async function getOrRegisterVault(bundle: JwtBundle): Promise<string | null> {
  const v = await authedJupiterFetch<{ vault: string }>('/trigger/v2/vault', bundle);
  if (v?.vault) return v.vault;
  const r = await authedJupiterFetch<{ vault: string }>('/trigger/v2/vault/register', bundle);
  return r?.vault ?? null;
}

interface CraftDepositResponse {
  transaction: string;
  depositRequestId: string;
}

interface CreateOrderResponse {
  id: string;
  txSignature: string;
}

async function loadJwtBundle(
  prisma: PrismaClient,
  userId: string,
): Promise<JwtBundle | null> {
  if (!env.JUPITER_API_KEY) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { jupiterJwt: true, jupiterJwtExpiresAt: true },
  });
  if (!user?.jupiterJwt || !user.jupiterJwtExpiresAt) return null;
  // 60s margin so we don't ship a token that expires mid-flight.
  if (user.jupiterJwtExpiresAt.getTime() - 60_000 <= Date.now()) return null;
  return { jwt: user.jupiterJwt, apiKey: env.JUPITER_API_KEY };
}

/**
 * Place a TP+SL OCO order server-side. Returns the count of Order rows
 * created (0 on failure, 2 on success). Idempotent — skips when an
 * OPEN OCO already exists for this position.
 */
export async function tryAutoPlaceExits(input: AutoExitInput): Promise<number> {
  if (!isDelegationConfigured()) return 0;

  const position = await input.prisma.position.findUnique({
    where: { id: input.positionId },
    select: { currentTpPrice: true, currentSlPrice: true },
  });
  const tp = position?.currentTpPrice?.toNumber() ?? null;
  const sl = position?.currentSlPrice?.toNumber() ?? null;
  if (tp == null || sl == null) {
    // OCO needs both legs. If only one is set we'd need a single-side
    // trigger, which we currently don't auto-place — user does it
    // manually. (This is rare in practice; proposal generator always
    // sets both.)
    return 0;
  }

  const existing = await input.prisma.order.findMany({
    where: {
      positionId: input.positionId,
      kind: { in: ['TAKE_PROFIT', 'STOP_LOSS'] },
      status: { in: ['OPEN', 'PARTIALLY_FILLED'] },
    },
    select: { id: true },
  });
  if (existing.length > 0) return 0;

  const asset = getAssetById(input.ticker);
  if (!asset?.mint) {
    console.warn(`[auto-exit] no mint configured for ${input.ticker}`);
    return 0;
  }

  const bundle = await loadJwtBundle(input.prisma, input.userId);
  if (!bundle) {
    console.warn(`[auto-exit] no jupiter jwt for user ${input.userId.slice(0, 8)}…`);
    return 0;
  }

  const vault = await getOrRegisterVault(bundle);
  if (!vault) return 0;

  const inputAmountSmallest = Math.floor(input.tokenAmount * 10 ** asset.decimals).toString();

  // Step 1: craft the deposit (transferring the xStock into the vault).
  const craft = await authedJupiterFetch<CraftDepositResponse>(
    '/trigger/v2/deposit/craft',
    bundle,
    {
      method: 'POST',
      body: { inputMint: asset.mint, inputAmount: inputAmountSmallest },
    },
  );
  if (!craft?.transaction || !craft.depositRequestId) return 0;

  // Step 2: server-sign via Privy.
  const signedTx = await signTransactionDelegated({
    privyWalletId: input.privyWalletId,
    transactionBase64: craft.transaction,
  });
  if (!signedTx) return 0;

  // Step 3: create OCO order. Single Jupiter id covers both TP + SL.
  const ocoBody = {
    orderType: 'OCO' as const,
    depositRequestId: craft.depositRequestId,
    depositSignedTx: signedTx,
    userPubkey: input.walletAddress,
    inputMint: asset.mint,
    inputAmount: inputAmountSmallest,
    outputMint: USDC_MINT,
    triggerMint: asset.mint,
    tpPriceUsd: tp,
    slPriceUsd: sl,
    tpSlippageBps: SLIPPAGE_BPS,
    slSlippageBps: SLIPPAGE_BPS,
    expiresAt: Date.now() + EXPIRY_MS,
  };
  const placed = await authedJupiterFetch<CreateOrderResponse>(
    '/trigger/v2/orders/price',
    bundle,
    { method: 'POST', body: ocoBody },
  );
  if (!placed?.id) return 0;

  // Step 4: write two Order rows sharing the OCO id. The tracker reads
  // events[].orderContext to attribute fills to TP vs SL on each row,
  // and the sibling-cancel hook in fills.ts uses the shared
  // jupiterOrderId to flip the losing leg to CANCELLED.
  await input.prisma.order.createMany({
    data: [
      {
        userId: input.userId,
        positionId: input.positionId,
        kind: 'TAKE_PROFIT',
        side: 'SELL',
        status: 'OPEN',
        jupiterOrderId: placed.id,
        triggerPriceUsd: new Prisma.Decimal(tp),
        sizeUsd: new Prisma.Decimal(input.tokenAmount * tp),
        tokenAmount: new Prisma.Decimal(input.tokenAmount),
        slippageBps: SLIPPAGE_BPS,
      },
      {
        userId: input.userId,
        positionId: input.positionId,
        kind: 'STOP_LOSS',
        side: 'SELL',
        status: 'OPEN',
        jupiterOrderId: placed.id,
        triggerPriceUsd: new Prisma.Decimal(sl),
        sizeUsd: new Prisma.Decimal(input.tokenAmount * sl),
        tokenAmount: new Prisma.Decimal(input.tokenAmount),
        slippageBps: SLIPPAGE_BPS,
      },
    ],
  });

  await input.prisma.position.update({
    where: { id: input.positionId },
    data: { state: 'ACTIVE' },
  });

  console.log(
    `[auto-exit] OCO placed id=${placed.id.slice(0, 8)}… for position ${input.positionId.slice(0, 8)}… tp=${tp} sl=${sl}`,
  );
  return 2;
}
