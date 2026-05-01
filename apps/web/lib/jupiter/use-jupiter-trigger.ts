'use client';

import { useCallback, useState } from 'react';
import { VersionedTransaction, Transaction } from '@solana/web3.js';
import { USDC_DECIMALS } from '@hunch-it/shared';
import { useWallet } from '@/lib/wallet/use-wallet';
import { useAuthedFetch } from '@/lib/auth/fetch';
import { getJupiterJwt } from './auth.js';
import {
  buildBuySingleOrder,
  buildSellOcoOrder,
  confirmCancel,
  craftDeposit,
  createOrder,
  getVault,
  initiateCancel,
  type CreateOrderResponse,
  type TriggerCondition,
} from './trigger.js';

function toBase64(bytes: Uint8Array): string {
  if (typeof window === 'undefined') return Buffer.from(bytes).toString('base64');
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i] ?? 0);
  return window.btoa(binary);
}
function fromBase64(str: string): Uint8Array {
  if (typeof window === 'undefined') return new Uint8Array(Buffer.from(str, 'base64'));
  const binary = window.atob(str);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return arr;
}

function deserializeTx(b64: string): VersionedTransaction | Transaction {
  const bytes = fromBase64(b64);
  try {
    return VersionedTransaction.deserialize(bytes);
  } catch {
    return Transaction.from(bytes);
  }
}

export type TriggerLoadingState =
  | 'auth'
  | 'vault'
  | 'craft'
  | 'sign'
  | 'submit'
  | 'cancel-initiate'
  | 'cancel-sign'
  | 'cancel-confirm'
  | null;

interface PlaceBuyArgs {
  outputMint: string;
  /** USD amount of USDC to deposit (e.g. 100 for $100). */
  usdAmount: number;
  triggerPriceUsd: number;
  /** "below" = limit-buy lower; "above" = breakout-buy. */
  triggerCondition?: TriggerCondition;
  /** basis points, e.g. 50 = 0.5%. */
  slippageBps?: number;
  /** Unix MILLISECONDS. Defaults to +24h. */
  expiresAt?: number;
}

export interface PlaceBuyResult extends CreateOrderResponse {
  vault: string;
  inputAmount: string;
}

interface PlaceSellExitArgs {
  inputMint: string;
  inputDecimals: number;
  /** Token amount of inputMint to sell across BOTH OCO legs (will be
   *  scaled to smallest units). */
  tokenAmount: number;
  tpPriceUsd: number;
  slPriceUsd: number;
  tpSlippageBps?: number;
  slSlippageBps?: number;
  expiresAt?: number;
}

/**
 * Hook wrapping Jupiter Trigger v2 BUY (single) + SELL (OCO) flows.
 *
 * v2 changes from the legacy hook:
 *   - JWT auth step before vault. The wallet signs Jupiter's challenge
 *     transaction once per 24h; cached in localStorage.
 *   - vault → /vault (no ?wallet param), with /register fallback baked
 *     in.
 *   - deposit/craft now returns depositRequestId, threaded into create.
 *   - SELL exits use native OCO instead of two singles.
 *   - expiresAt is unix MILLISECONDS, not seconds.
 *
 * Server-side persistence (Position + Order rows) is the caller's
 * responsibility — see /api/orders.
 */
export function useJupiterTrigger() {
  const { address, signTransaction } = useWallet();
  const authedFetch = useAuthedFetch();
  const [loading, setLoading] = useState<TriggerLoadingState>(null);
  const [lastOrder, setLastOrder] = useState<PlaceBuyResult | null>(null);

  const ensureJwt = useCallback(
    async (walletAddress: string) => {
      return getJupiterJwt({
        walletAddress,
        signTransaction,
        // Push every freshly-issued JWT to the server so the
        // ws-server tracker (which has no wallet of its own) can read
        // the user's Jupiter order history.
        persistToServer: async (jwt, expiresAt) => {
          await authedFetch('/api/users/me/jupiter-jwt', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jwt, expiresAt }),
          });
        },
      });
    },
    [signTransaction, authedFetch],
  );

  const placeBuy = useCallback(
    async (args: PlaceBuyArgs): Promise<PlaceBuyResult> => {
      if (!address) throw new Error('Wallet not connected');
      const inputAmount = Math.round(args.usdAmount * 10 ** USDC_DECIMALS).toString();
      const expiresAt = args.expiresAt ?? Date.now() + 24 * 3600 * 1000;
      const triggerCondition = args.triggerCondition ?? 'below';
      const slippageBps = args.slippageBps ?? 50;

      setLoading('auth');
      const jwt = await ensureJwt(address);
      const carrier = { getJwt: async () => jwt };

      setLoading('vault');
      const vault = await getVault(carrier);

      setLoading('craft');
      const { USDC_MINT } = await import('@hunch-it/shared');
      const craft = await craftDeposit(
        { inputMint: USDC_MINT, inputAmount },
        carrier,
      );

      setLoading('sign');
      const tx = deserializeTx(craft.transaction);
      const signed = await signTransaction(tx);
      const signedB64 = toBase64(
        signed instanceof VersionedTransaction
          ? signed.serialize()
          : (signed as Transaction).serialize(),
      );

      setLoading('submit');
      const req = buildBuySingleOrder({
        userPubkey: address,
        depositRequestId: craft.depositRequestId,
        depositSignedTx: signedB64,
        outputMint: args.outputMint,
        usdcAmount: inputAmount,
        triggerPriceUsd: args.triggerPriceUsd,
        triggerCondition,
        slippageBps,
        expiresAt,
      });
      const placed = await createOrder(req, carrier);

      setLoading(null);
      const result: PlaceBuyResult = {
        ...placed,
        vault: vault.vault,
        inputAmount,
      };
      setLastOrder(result);
      return result;
    },
    [address, signTransaction, ensureJwt],
  );

  /**
   * Place a SELL OCO (TP+SL) order against an existing position. v2's
   * native OCO replaces the two-singles workaround the old hook used.
   */
  const placeSellExit = useCallback(
    async (args: PlaceSellExitArgs): Promise<PlaceBuyResult> => {
      if (!address) throw new Error('Wallet not connected');
      const inputAmount = Math.round(args.tokenAmount * 10 ** args.inputDecimals).toString();
      const expiresAt = args.expiresAt ?? Date.now() + 7 * 24 * 3600 * 1000;
      const tpSlippageBps = args.tpSlippageBps ?? 75;
      const slSlippageBps = args.slSlippageBps ?? 75;

      setLoading('auth');
      const jwt = await ensureJwt(address);
      const carrier = { getJwt: async () => jwt };

      setLoading('vault');
      const vault = await getVault(carrier);

      setLoading('craft');
      const craft = await craftDeposit(
        { inputMint: args.inputMint, inputAmount },
        carrier,
      );

      setLoading('sign');
      const tx = deserializeTx(craft.transaction);
      const signed = await signTransaction(tx);
      const signedB64 = toBase64(
        signed instanceof VersionedTransaction
          ? signed.serialize()
          : (signed as Transaction).serialize(),
      );

      setLoading('submit');
      const req = buildSellOcoOrder({
        userPubkey: address,
        depositRequestId: craft.depositRequestId,
        depositSignedTx: signedB64,
        inputMint: args.inputMint,
        inputAmount,
        tpPriceUsd: args.tpPriceUsd,
        slPriceUsd: args.slPriceUsd,
        tpSlippageBps,
        slSlippageBps,
        expiresAt,
      });
      const placed = await createOrder(req, carrier);

      setLoading(null);
      const result: PlaceBuyResult = { ...placed, vault: vault.vault, inputAmount };
      setLastOrder(result);
      return result;
    },
    [address, signTransaction, ensureJwt],
  );

  const cancel = useCallback(
    async (orderId: string): Promise<{ txSignature: string }> => {
      if (!address) throw new Error('Wallet not connected');

      setLoading('auth');
      const jwt = await ensureJwt(address);
      const carrier = { getJwt: async () => jwt };

      setLoading('cancel-initiate');
      const initiate = await initiateCancel(orderId, carrier);

      setLoading('cancel-sign');
      const tx = deserializeTx(initiate.transaction);
      const signed = await signTransaction(tx);

      setLoading('cancel-confirm');
      const confirm = await confirmCancel(
        orderId,
        {
          signedTransaction: toBase64(
            signed instanceof VersionedTransaction
              ? signed.serialize()
              : (signed as Transaction).serialize(),
          ),
          cancelRequestId: initiate.requestId,
        },
        carrier,
      );
      setLoading(null);
      return { txSignature: confirm.txSignature };
    },
    [address, signTransaction, ensureJwt],
  );

  return { placeBuy, placeSellExit, cancel, loading, lastOrder };
}
