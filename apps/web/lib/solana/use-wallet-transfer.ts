'use client';

import { useCallback } from 'react';
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { useConnection } from '@solana/wallet-adapter-react';
import {
  address,
  isSignerRole,
  isWritableRole,
  type AccountMeta as KitAccountMeta,
  type Address,
  type Instruction as KitInstruction,
  type TransactionSigner,
} from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import { USDC_DECIMALS, USDC_MINT } from '@hunch-it/shared';
import { useWallet } from '@/lib/wallet/use-wallet';

export type TransferAsset = 'USDC' | 'SOL';

export interface PreparedWalletTransfer {
  asset: TransferAsset;
  amount: string;
  amountRaw: bigint;
  destinationAddress: string;
  transaction: Transaction;
  latestBlockhash: {
    blockhash: string;
    lastValidBlockHeight: number;
  };
  estimatedFeeLamports: number;
  rentLamports: number;
  estimatedSolCostLamports: number;
  createsRecipientTokenAccount: boolean;
}

export type WalletTransferStatus = 'confirmed' | 'failed' | 'unknown';

export interface WalletTransferResult {
  status: WalletTransferStatus;
  signature: string;
  error?: string;
}

const TOKEN_ACCOUNT_SIZE = 165;
const SOL_MAX_BUFFER_LAMPORTS = 10_000;
const FALLBACK_FEE_LAMPORTS = 5_000;

function parseDecimalToUnits(value: string, decimals: number): bigint {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) {
    throw new Error('Enter a valid amount.');
  }
  const [wholeRaw = '0', fractionRaw = ''] = trimmed.split('.');
  if (fractionRaw.length > decimals) {
    throw new Error(`${decimals} decimal places max for this asset.`);
  }
  const whole = wholeRaw.replace(/^0+(?=\d)/, '') || '0';
  const fraction = fractionRaw.padEnd(decimals, '0');
  const raw = BigInt(`${whole}${fraction}`);
  if (raw <= 0n) throw new Error('Amount must be greater than zero.');
  return raw;
}

function unitsToDecimal(raw: bigint, decimals: number): string {
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const fraction = (abs % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole.toString()}${fraction ? `.${fraction}` : ''}`;
}

function toKitAddress(publicKey: PublicKey | string): Address {
  return address(typeof publicKey === 'string' ? publicKey : publicKey.toBase58());
}

function readonlySigner(addr: Address): TransactionSigner {
  return { address: addr } as TransactionSigner;
}

function kitInstructionToWeb3(ix: KitInstruction, signerAddress: string): TransactionInstruction {
  const accounts = (ix.accounts ?? []) as readonly KitAccountMeta[];
  return new TransactionInstruction({
    programId: new PublicKey(ix.programAddress),
    keys: accounts.map((account) => ({
      pubkey: new PublicKey(account.address),
      isSigner: isSignerRole(account.role) || account.address === signerAddress,
      isWritable: isWritableRole(account.role),
    })),
    data: (ix.data ?? new Uint8Array()) as Buffer,
  });
}

function shortError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}

function isLikelyUserRejection(err: unknown): boolean {
  const text = shortError(err).toLowerCase();
  return text.includes('reject') || text.includes('cancel') || text.includes('declin');
}

interface UsdcTokenAccount {
  pubkey: PublicKey;
  raw: bigint;
}

export function useWalletTransfer() {
  const { connection } = useConnection();
  const { publicKey, signAndSendTransaction } = useWallet();

  const getSolBalanceLamports = useCallback(async (): Promise<number> => {
    if (!publicKey) throw new Error('Wallet not connected.');
    return connection.getBalance(publicKey, 'confirmed');
  }, [connection, publicKey]);

  const getUsdcTokenAccounts = useCallback(async (): Promise<UsdcTokenAccount[]> => {
    if (!publicKey) throw new Error('Wallet not connected.');
    const tokenProgram = new PublicKey(TOKEN_PROGRAM_ADDRESS);
    const accounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
      programId: tokenProgram,
    });
    return accounts.value
      .map((account) => {
        const data = account.account.data;
        if (!('parsed' in data)) return null;
        const info = data.parsed?.info;
        if (info?.mint !== USDC_MINT) return null;
        const raw = BigInt(info?.tokenAmount?.amount ?? '0');
        if (raw <= 0n) return null;
        return { pubkey: account.pubkey, raw };
      })
      .filter((account): account is UsdcTokenAccount => account != null);
  }, [connection, publicKey]);

  const getMaxTransferAmount = useCallback(
    async (asset: TransferAsset): Promise<string> => {
      if (!publicKey) throw new Error('Wallet not connected.');
      if (asset === 'USDC') {
        const accounts = await getUsdcTokenAccounts();
        const total = accounts.reduce((acc, account) => acc + account.raw, 0n);
        return unitsToDecimal(total, USDC_DECIMALS);
      }

      const balance = BigInt(await getSolBalanceLamports());
      const latestBlockhash = await connection.getLatestBlockhash('confirmed');
      const tx = new Transaction({
        feePayer: publicKey,
        recentBlockhash: latestBlockhash.blockhash,
      });
      const signerAddress = toKitAddress(publicKey);
      const transferIx = getTransferSolInstruction({
        source: readonlySigner(signerAddress),
        destination: signerAddress,
        amount: 1n,
      });
      tx.add(kitInstructionToWeb3(transferIx, signerAddress));
      const fee = await connection.getFeeForMessage(tx.compileMessage(), 'confirmed');
      const feeLamports = BigInt(fee.value ?? FALLBACK_FEE_LAMPORTS);
      const max = balance - feeLamports - BigInt(SOL_MAX_BUFFER_LAMPORTS);
      return unitsToDecimal(max > 0n ? max : 0n, 9);
    },
    [connection, getSolBalanceLamports, getUsdcTokenAccounts, publicKey],
  );

  const prepare = useCallback(
    async (args: {
      asset: TransferAsset;
      destinationAddress: string;
      amount: string;
    }): Promise<PreparedWalletTransfer> => {
      if (!publicKey) throw new Error('Wallet not connected.');
      let destination: PublicKey;
      try {
        destination = new PublicKey(args.destinationAddress.trim());
      } catch {
        throw new Error('Enter a valid Solana address.');
      }
      if (destination.equals(publicKey)) {
        throw new Error('Destination cannot be your Hunch wallet.');
      }
      const tokenProgram = new PublicKey(TOKEN_PROGRAM_ADDRESS);
      const destinationInfo = await connection.getAccountInfo(destination, 'confirmed');
      if (destinationInfo?.owner.equals(tokenProgram)) {
        throw new Error('Use a wallet address, not a token account address.');
      }

      const amountRaw = parseDecimalToUnits(args.amount, args.asset === 'USDC' ? USDC_DECIMALS : 9);
      const latestBlockhash = await connection.getLatestBlockhash('confirmed');
      const tx = new Transaction({
        feePayer: publicKey,
        recentBlockhash: latestBlockhash.blockhash,
      });
      const signerAddress = toKitAddress(publicKey);
      let rentLamports = 0;
      let createsRecipientTokenAccount = false;

      if (args.asset === 'SOL') {
        const solBalance = BigInt(await getSolBalanceLamports());
        const transferIx = getTransferSolInstruction({
          source: readonlySigner(signerAddress),
          destination: toKitAddress(destination),
          amount: amountRaw,
        });
        tx.add(kitInstructionToWeb3(transferIx, signerAddress));
        const fee = await connection.getFeeForMessage(tx.compileMessage(), 'confirmed');
        const estimatedFeeLamports = fee.value ?? FALLBACK_FEE_LAMPORTS;
        if (solBalance < amountRaw + BigInt(estimatedFeeLamports)) {
          throw new Error('Not enough SOL for this amount and network fee.');
        }
        return {
          asset: args.asset,
          amount: unitsToDecimal(amountRaw, 9),
          amountRaw,
          destinationAddress: destination.toBase58(),
          transaction: tx,
          latestBlockhash,
          estimatedFeeLamports,
          rentLamports,
          estimatedSolCostLamports: estimatedFeeLamports,
          createsRecipientTokenAccount,
        };
      }

      const mint = toKitAddress(USDC_MINT);
      const destinationOwner = toKitAddress(destination);
      const [destinationAta] = await findAssociatedTokenPda({
        owner: destinationOwner,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
        mint,
      });
      const destinationAtaPk = new PublicKey(destinationAta);
      const destinationAtaInfo = await connection.getAccountInfo(destinationAtaPk, 'confirmed');
      createsRecipientTokenAccount = destinationAtaInfo == null;
      if (createsRecipientTokenAccount) {
        rentLamports = await connection.getMinimumBalanceForRentExemption(
          TOKEN_ACCOUNT_SIZE,
          'confirmed',
        );
      }

      const createAtaIx = getCreateAssociatedTokenIdempotentInstruction({
        payer: readonlySigner(signerAddress),
        ata: destinationAta,
        owner: destinationOwner,
        mint,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      });
      tx.add(kitInstructionToWeb3(createAtaIx, signerAddress));

      const accounts = await getUsdcTokenAccounts();
      const totalUsdc = accounts.reduce((acc, account) => acc + account.raw, 0n);
      if (totalUsdc < amountRaw) throw new Error('Not enough USDC.');

      let remaining = amountRaw;
      for (const account of accounts) {
        if (remaining <= 0n) break;
        const chunk = account.raw < remaining ? account.raw : remaining;
        remaining -= chunk;
        const transferIx = getTransferCheckedInstruction({
          source: toKitAddress(account.pubkey),
          mint,
          destination: destinationAta,
          authority: readonlySigner(signerAddress),
          amount: chunk,
          decimals: USDC_DECIMALS,
        });
        tx.add(kitInstructionToWeb3(transferIx, signerAddress));
      }

      const fee = await connection.getFeeForMessage(tx.compileMessage(), 'confirmed');
      const estimatedFeeLamports = fee.value ?? FALLBACK_FEE_LAMPORTS;
      const estimatedSolCostLamports = estimatedFeeLamports + rentLamports;
      const solBalance = await getSolBalanceLamports();
      if (solBalance < estimatedSolCostLamports) {
        throw new Error('Add SOL to pay the network fee before sending USDC.');
      }

      return {
        asset: args.asset,
        amount: unitsToDecimal(amountRaw, USDC_DECIMALS),
        amountRaw,
        destinationAddress: destination.toBase58(),
        transaction: tx,
        latestBlockhash,
        estimatedFeeLamports,
        rentLamports,
        estimatedSolCostLamports,
        createsRecipientTokenAccount,
      };
    },
    [connection, getSolBalanceLamports, getUsdcTokenAccounts, publicKey],
  );

  const send = useCallback(
    async (prepared: PreparedWalletTransfer): Promise<WalletTransferResult> => {
      if (!publicKey || !signAndSendTransaction) throw new Error('Wallet not connected.');
      let signature: string;
      try {
        const sent = await signAndSendTransaction(prepared.transaction);
        signature = sent.signature;
      } catch (err) {
        if (isLikelyUserRejection(err)) {
          throw new Error('Transaction was not signed. No funds moved.');
        }
        throw err;
      }

      try {
        const confirmation = await connection.confirmTransaction(
          {
            signature,
            blockhash: prepared.latestBlockhash.blockhash,
            lastValidBlockHeight: prepared.latestBlockhash.lastValidBlockHeight,
          },
          'confirmed',
        );
        if (confirmation.value.err) {
          return {
            status: 'failed',
            signature,
            error: JSON.stringify(confirmation.value.err),
          };
        }
        return { status: 'confirmed', signature };
      } catch (err) {
        return { status: 'unknown', signature, error: shortError(err) };
      }
    },
    [connection, publicKey, signAndSendTransaction],
  );

  return {
    getMaxTransferAmount,
    prepare,
    send,
  };
}
