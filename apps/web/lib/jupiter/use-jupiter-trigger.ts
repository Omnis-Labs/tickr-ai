'use client';

import { useCallback, useState } from 'react';
import { VersionedTransaction } from '@solana/web3.js';
import { USDC_DECIMALS, USDC_MINT } from '@hunch-it/shared';

const USDC_MINT_LOCAL = USDC_MINT;
import { useWallet } from '@/lib/wallet/use-wallet';
import {
  buildBuyOrderRequest,
  confirmCancel,
  craftDeposit,
  getVault,
  initiateCancel,
  placePriceOrder,
  type PlacePriceOrderResponse,
  type TriggerCondition,
} from './trigger';

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

export type TriggerLoadingState =
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
  /** Unix seconds. Defaults to +24h. */
  expiresAt?: number;
}

export interface PlaceBuyResult extends PlacePriceOrderResponse {
  vault: string;
  inputAmount: string;
}

interface PlaceSellExitArgs {
  /** xStock mint we're selling (will be deposited into vault). */
  inputMint: string;
  /** xStock decimals (typically 8). */
  inputDecimals: number;
  /** Token amount of inputMint to sell, in human units (will be scaled to smallest units). */
  tokenAmount: number;
  /** TP/SL trigger price in USD. */
  triggerPriceUsd: number;
  /** "above" for TP, "below" for SL. */
  triggerCondition: TriggerCondition;
  slippageBps?: number;
  expiresAt?: number;
}

/**
 * React hook wrapping the four-step Jupiter Trigger Order v2 BUY flow plus
 * the two-step cancel flow. The hook drives the user wallet for both signing
 * steps; server-side persistence (Position + Order rows) is the caller's
 * responsibility — see /api/orders.
 */
export function useJupiterTrigger() {
  const { address, signTransaction } = useWallet();
  const [loading, setLoading] = useState<TriggerLoadingState>(null);
  const [lastOrder, setLastOrder] = useState<PlaceBuyResult | null>(null);

  const placeBuy = useCallback(
    async (args: PlaceBuyArgs): Promise<PlaceBuyResult> => {
      if (!address) throw new Error('Wallet not connected');
      const inputAmount = Math.round(args.usdAmount * 10 ** USDC_DECIMALS).toString();
      const expiresAt = args.expiresAt ?? Math.floor(Date.now() / 1000) + 24 * 3600;
      const triggerCondition = args.triggerCondition ?? 'below';
      const slippageBps = args.slippageBps ?? 50;

      setLoading('vault');
      const vault = await getVault(address);

      setLoading('craft');
      const craft = await craftDeposit({
        wallet: address,
        vault: vault.vault,
        mint: '', // USDC; trigger.ts fills it from constants
        amount: inputAmount,
      });
      // The wrapper above passes mint as USDC explicitly via buildBuyOrderRequest;
      // craftDeposit just shuttles the bytes back. Some Jupiter deployments expect
      // the USDC mint string here — re-fetch craft if needed.

      setLoading('sign');
      const tx = VersionedTransaction.deserialize(fromBase64(craft.transaction));
      const signed = await signTransaction(tx);
      const signedB64 = toBase64(signed.serialize());

      setLoading('submit');
      const placeReq = buildBuyOrderRequest({
        walletAddress: address,
        vault: vault.vault,
        signedDepositTransaction: signedB64,
        outputMint: args.outputMint,
        usdcAmount: inputAmount,
        triggerPriceUsd: args.triggerPriceUsd,
        triggerCondition,
        slippageBps,
        expiresAt,
      });
      const placed = await placePriceOrder(placeReq);

      setLoading(null);
      const result: PlaceBuyResult = {
        ...placed,
        vault: vault.vault,
        inputAmount,
      };
      setLastOrder(result);
      return result;
    },
    [address, signTransaction],
  );

  /**
   * Place a SELL trigger order against an existing position. Used for Phase F
   * manual TP/SL placement after BUY fills (Position state=ENTERING). Same
   * four-step flow as placeBuy but with input=xStock, output=USDC.
   *
   * NOTE: vault may already hold the post-BUY xStock balance; the
   * deposit/craft step here may be a no-op or zero-value tx depending on
   * Jupiter's current contract. Verify behavior before pushing live.
   */
  const placeSellExit = useCallback(
    async (args: PlaceSellExitArgs): Promise<PlaceBuyResult> => {
      if (!address) throw new Error('Wallet not connected');
      const inputAmount = Math.round(args.tokenAmount * 10 ** args.inputDecimals).toString();
      const expiresAt = args.expiresAt ?? Math.floor(Date.now() / 1000) + 24 * 3600;
      const slippageBps = args.slippageBps ?? 75;

      setLoading('vault');
      const vault = await getVault(address);

      setLoading('craft');
      const craft = await craftDeposit({
        wallet: address,
        vault: vault.vault,
        mint: args.inputMint,
        amount: inputAmount,
      });

      setLoading('sign');
      const tx = VersionedTransaction.deserialize(fromBase64(craft.transaction));
      const signed = await signTransaction(tx);
      const signedB64 = toBase64(signed.serialize());

      setLoading('submit');
      const placed = await placePriceOrder({
        vault: vault.vault,
        signedDepositTransaction: signedB64,
        inputMint: args.inputMint,
        outputMint: USDC_MINT_LOCAL, // imported below
        inputAmount,
        triggerPriceUsd: args.triggerPriceUsd,
        triggerCondition: args.triggerCondition,
        slippageBps,
        expiresAt,
      });
      setLoading(null);
      const result: PlaceBuyResult = { ...placed, vault: vault.vault, inputAmount };
      setLastOrder(result);
      return result;
    },
    [address, signTransaction],
  );

  const cancel = useCallback(
    async (orderId: string): Promise<{ txSignature: string }> => {
      if (!signTransaction) throw new Error('Wallet not connected');
      setLoading('cancel-initiate');
      const initiate = await initiateCancel(orderId);

      setLoading('cancel-sign');
      const tx = VersionedTransaction.deserialize(fromBase64(initiate.transaction));
      const signed = await signTransaction(tx);

      setLoading('cancel-confirm');
      const confirm = await confirmCancel({
        orderId,
        signedWithdrawalTx: toBase64(signed.serialize()),
      });
      setLoading(null);
      return { txSignature: confirm.txSignature };
    },
    [signTransaction],
  );

  return { placeBuy, placeSellExit, cancel, loading, lastOrder };
}
