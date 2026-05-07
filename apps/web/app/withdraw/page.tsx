'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { TopAppBar } from '@/components/shell/top-app-bar';
import { QK, usePortfolio } from '@/lib/hooks/queries';
import {
  type PreparedWalletTransfer,
  type TransferAsset,
  type WalletTransferResult,
  useWalletTransfer,
} from '@/lib/solana/use-wallet-transfer';
import { useWallet } from '@/lib/wallet/use-wallet';

const SOL_LAMPORTS = 1_000_000_000;

const ASSETS: Record<
  TransferAsset,
  {
    icon: string;
    label: string;
    helper: string;
    amountPlaceholder: string;
  }
> = {
  USDC: {
    icon: 'payments',
    label: 'USDC',
    helper: 'Idle USDC in your wallet',
    amountPlaceholder: '0.00',
  },
  SOL: {
    icon: 'bolt',
    label: 'SOL',
    helper: 'Fee balance and transferable SOL',
    amountPlaceholder: '0.00000',
  },
};

function formatUsdc(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatSol(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: value < 0.01 && value > 0 ? 6 : 4,
    maximumFractionDigits: 6,
  });
}

function formatSolFromLamports(lamports: number): string {
  return formatSol(lamports / SOL_LAMPORTS);
}

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function solscanTxUrl(signature: string): string {
  return `https://solscan.io/tx/${signature}`;
}

function isLowSolForFees(solBalance: number): boolean {
  return solBalance <= 0;
}

export default function WithdrawPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const wallet = useWallet();
  const portfolioQuery = usePortfolio();
  const transfer = useWalletTransfer();

  const [asset, setAsset] = useState<TransferAsset>('USDC');
  const [destinationAddress, setDestinationAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [prepared, setPrepared] = useState<PreparedWalletTransfer | null>(null);
  const [result, setResult] = useState<WalletTransferResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isLoadingMax, setIsLoadingMax] = useState(false);
  const [copied, setCopied] = useState(false);

  const cashUsd = portfolioQuery.data?.cashUsd ?? 0;
  const solBalance = portfolioQuery.data?.solBalance ?? 0;
  const assetBalanceLabel = asset === 'USDC'
    ? `${formatUsdc(cashUsd)} USDC`
    : `${formatSol(solBalance)} SOL`;

  const feeReadyLabel = useMemo(() => {
    if (isLowSolForFees(solBalance)) return 'Add SOL before sending';
    return `${formatSol(solBalance)} SOL available`;
  }, [solBalance]);

  function resetReviewState() {
    setPrepared(null);
    setResult(null);
    setError(null);
  }

  function changeAsset(next: TransferAsset) {
    setAsset(next);
    setAmount('');
    resetReviewState();
  }

  function changeAmount(next: string) {
    setAmount(next);
    resetReviewState();
  }

  function changeDestination(next: string) {
    setDestinationAddress(next);
    resetReviewState();
  }

  async function copyAddress() {
    if (!wallet.address) return;
    try {
      await navigator.clipboard.writeText(wallet.address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy address. Select the address from Deposit instead.');
    }
  }

  async function fillMax() {
    setError(null);
    setIsLoadingMax(true);
    try {
      const max = await transfer.getMaxTransferAmount(asset);
      setAmount(max);
      setPrepared(null);
      setResult(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoadingMax(false);
    }
  }

  async function prepareTransfer() {
    setError(null);
    setResult(null);
    setIsPreparing(true);
    try {
      const next = await transfer.prepare({
        asset,
        destinationAddress,
        amount,
      });
      setPrepared(next);
    } catch (err) {
      setPrepared(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsPreparing(false);
    }
  }

  async function sendTransfer() {
    if (!prepared) return;
    setError(null);
    setIsSending(true);
    try {
      const nextResult = await transfer.send(prepared);
      setResult(nextResult);
      void queryClient.invalidateQueries({ queryKey: QK.portfolio() });
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSending(false);
    }
  }

  const canContinue =
    wallet.connected &&
    destinationAddress.trim().length > 0 &&
    amount.trim().length > 0 &&
    !isPreparing &&
    !isSending;

  return (
    <>
      <TopAppBar
        title="Withdraw"
        leftAction={
          <button
            type="button"
            aria-label="Back"
            onClick={() => router.back()}
            className="w-11 h-11 rounded-full bg-surface flex items-center justify-center text-primary shadow-sm active:scale-[0.97] transition-transform"
          >
            <span className="material-symbols-outlined text-[22px]">arrow_back</span>
          </button>
        }
      />

      <main className="px-5 py-6 pb-28 max-w-md mx-auto">
        {!wallet.connected ? (
          <section className="bg-surface rounded-lg p-6 shadow-soft flex flex-col items-center text-center">
            <div className="w-12 h-12 rounded-full bg-surface-container flex items-center justify-center mb-3">
              <span className="material-symbols-outlined text-primary text-[24px]">login</span>
            </div>
            <p className="text-title-md text-primary mb-1">Sign in to withdraw</p>
            <p className="text-body-sm text-on-surface-variant mb-4">
              Your Solana wallet is needed to build and sign transfers.
            </p>
            <button
              type="button"
              onClick={wallet.login}
              className="px-5 py-2.5 bg-primary text-on-primary rounded-full text-label-md active:scale-[0.97] transition-transform"
            >
              Sign in
            </button>
          </section>
        ) : (
          <div className="flex flex-col gap-5">
            <motion.section
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-surface rounded-lg p-5 shadow-soft"
            >
              <div className="flex flex-col gap-4">
                <div>
                  <h2 className="text-title-lg text-primary">Send from wallet</h2>
                  <p className="text-body-sm text-on-surface-variant mt-1">
                    Withdraw only idle wallet USDC or SOL.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2 bg-surface-container-low rounded-lg p-1">
                  {(['USDC', 'SOL'] as const).map((option) => {
                    const selected = option === asset;
                    const meta = ASSETS[option];
                    return (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => changeAsset(option)}
                        className={`h-12 rounded-md text-label-lg flex items-center justify-center gap-2 transition-colors ${
                          selected
                            ? 'bg-primary text-on-primary shadow-micro'
                            : 'text-on-surface-variant'
                        }`}
                      >
                        <span className="material-symbols-outlined text-[18px]">{meta.icon}</span>
                        {meta.label}
                      </button>
                    );
                  })}
                </div>

                <div className="rounded-lg border border-outline-variant bg-surface-container-low p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-label-md text-on-surface-variant">Available</p>
                    <p className="text-title-md text-on-surface tabular-nums">{assetBalanceLabel}</p>
                  </div>
                  <p className="text-body-sm text-on-surface-variant text-right">
                    {ASSETS[asset].helper}
                  </p>
                </div>

                <label className="flex flex-col gap-2">
                  <span className="text-label-lg text-on-surface">Amount</span>
                  <div className="flex items-center gap-2 bg-surface-container-low border border-outline-variant rounded-lg px-4 h-14">
                    <input
                      value={amount}
                      onChange={(event) => changeAmount(event.target.value)}
                      inputMode="decimal"
                      placeholder={ASSETS[asset].amountPlaceholder}
                      className="min-w-0 flex-1 bg-transparent text-number-md text-on-surface outline-none placeholder:text-icon-muted"
                    />
                    <button
                      type="button"
                      onClick={fillMax}
                      disabled={isLoadingMax}
                      className="h-9 px-3 rounded-full bg-primary text-on-primary text-label-md disabled:opacity-50"
                    >
                      {isLoadingMax ? '...' : 'Max'}
                    </button>
                  </div>
                </label>

                <label className="flex flex-col gap-2">
                  <span className="text-label-lg text-on-surface">Destination wallet</span>
                  <input
                    value={destinationAddress}
                    onChange={(event) => changeDestination(event.target.value)}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="Solana wallet address"
                    className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-4 h-14 text-body-md text-on-surface outline-none placeholder:text-icon-muted font-mono"
                  />
                </label>

                <div
                  className={`rounded-lg border p-4 flex items-start gap-3 ${
                    isLowSolForFees(solBalance)
                      ? 'border-negative/40 bg-negative-container/70'
                      : 'border-outline-variant bg-surface-container-low'
                  }`}
                >
                  <div className="w-9 h-9 rounded-full bg-surface flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-[20px] text-primary">bolt</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-label-lg text-on-surface">Fee readiness</p>
                      <p
                        className={`text-label-md text-right ${
                          isLowSolForFees(solBalance) ? 'text-negative' : 'text-positive'
                        }`}
                      >
                        {feeReadyLabel}
                      </p>
                    </div>
                    <p className="text-body-sm text-on-surface-variant mt-1">
                      Exact network cost is estimated before signing. USDC sends also need SOL.
                    </p>
                    {isLowSolForFees(solBalance) && wallet.address && (
                      <button
                        type="button"
                        onClick={copyAddress}
                        className="mt-3 inline-flex items-center gap-2 h-9 px-3 rounded-full bg-primary text-on-primary text-label-md active:scale-[0.97] transition-transform"
                      >
                        <span className="material-symbols-outlined text-[16px]">
                          {copied ? 'check' : 'content_copy'}
                        </span>
                        {copied ? 'Copied' : 'Copy deposit address'}
                      </button>
                    )}
                  </div>
                </div>

                {error && (
                  <div className="rounded-lg bg-negative-container text-on-error-container px-4 py-3 text-body-sm">
                    {error}
                    {wallet.address && error.toLowerCase().includes('sol') && (
                      <button
                        type="button"
                        onClick={copyAddress}
                        className="mt-3 flex items-center gap-2 text-label-md text-primary"
                      >
                        <span className="material-symbols-outlined text-[16px]">
                          {copied ? 'check' : 'content_copy'}
                        </span>
                        {copied ? 'Copied' : `Copy ${truncateAddress(wallet.address)}`}
                      </button>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  onClick={prepareTransfer}
                  disabled={!canContinue}
                  className="h-12 rounded-full bg-primary text-on-primary text-label-lg flex items-center justify-center gap-2 disabled:opacity-50 disabled:active:scale-100 active:scale-[0.97] transition-transform"
                >
                  {isPreparing ? (
                    'Checking...'
                  ) : (
                    <>
                      Continue
                      <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                    </>
                  )}
                </button>
              </div>
            </motion.section>

            {prepared && !result && (
              <ReviewCard
                prepared={prepared}
                isSending={isSending}
                onEdit={() => setPrepared(null)}
                onSend={sendTransfer}
              />
            )}

            {result && prepared && (
              <ResultCard
                prepared={prepared}
                result={result}
                onNewTransfer={() => {
                  setPrepared(null);
                  setResult(null);
                  setAmount('');
                  setDestinationAddress('');
                }}
              />
            )}
          </div>
        )}
      </main>
    </>
  );
}

function ReviewCard({
  prepared,
  isSending,
  onEdit,
  onSend,
}: {
  prepared: PreparedWalletTransfer;
  isSending: boolean;
  onEdit: () => void;
  onSend: () => void;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-surface rounded-lg p-5 shadow-soft"
    >
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="text-title-lg text-primary">Review</h2>
        <button
          type="button"
          onClick={onEdit}
          disabled={isSending}
          className="text-label-md text-on-surface-variant disabled:opacity-50"
        >
          Edit
        </button>
      </div>

      <div className="flex flex-col divide-y divide-divider border border-outline-variant rounded-lg overflow-hidden">
        <ReviewRow label="You send" value={`${prepared.amount} ${prepared.asset}`} />
        <ReviewRow label="To" value={truncateAddress(prepared.destinationAddress)} mono />
        <ReviewRow
          label="Network cost"
          value={`${formatSolFromLamports(prepared.estimatedSolCostLamports)} SOL`}
        />
        {prepared.createsRecipientTokenAccount && (
          <ReviewRow label="Recipient USDC account" value="Created by this transfer" />
        )}
      </div>

      <p className="text-body-sm text-on-surface-variant mt-3">
        Fees may still be charged if a submitted transaction fails on-chain.
      </p>

      <button
        type="button"
        onClick={onSend}
        disabled={isSending}
        className="mt-5 h-12 w-full rounded-full bg-primary text-on-primary text-label-lg flex items-center justify-center gap-2 disabled:opacity-50 disabled:active:scale-100 active:scale-[0.97] transition-transform"
      >
        {isSending ? (
          'Sending...'
        ) : (
          <>
            Send {prepared.asset}
            <span className="material-symbols-outlined text-[18px]">send</span>
          </>
        )}
      </button>
    </motion.section>
  );
}

function ReviewRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 bg-surface-container-low px-4 py-3">
      <span className="text-body-sm text-on-surface-variant">{label}</span>
      <span
        className={`text-label-lg text-on-surface text-right min-w-0 ${
          mono ? 'font-mono' : 'tabular-nums'
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function ResultCard({
  prepared,
  result,
  onNewTransfer,
}: {
  prepared: PreparedWalletTransfer;
  result: WalletTransferResult;
  onNewTransfer: () => void;
}) {
  const confirmed = result.status === 'confirmed';
  const failed = result.status === 'failed';
  const title = confirmed
    ? 'Transfer confirmed'
    : failed
      ? 'Transaction failed'
      : 'Confirmation pending';
  const icon = confirmed ? 'check_circle' : failed ? 'error' : 'schedule';
  const iconClass = confirmed ? 'text-positive' : failed ? 'text-negative' : 'text-primary';
  const copy = confirmed
    ? `${prepared.amount} ${prepared.asset} was sent.`
    : failed
      ? 'The network reported a failed transaction. Network fees may still be charged.'
      : 'The transaction was submitted, but confirmation did not finish in time.';

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-surface rounded-lg p-5 shadow-soft flex flex-col items-center text-center"
    >
      <div className="w-14 h-14 rounded-full bg-surface-container flex items-center justify-center mb-3">
        <span className={`material-symbols-outlined text-[28px] ${iconClass}`}>{icon}</span>
      </div>
      <h2 className="text-title-lg text-primary">{title}</h2>
      <p className="text-body-sm text-on-surface-variant mt-1">{copy}</p>
      {result.error && (
        <p className="text-body-sm text-negative mt-3 break-words">{result.error}</p>
      )}

      <div className="flex flex-col gap-2 w-full mt-5">
        <a
          href={solscanTxUrl(result.signature)}
          target="_blank"
          rel="noreferrer"
          className="h-11 rounded-full bg-primary text-on-primary text-label-lg flex items-center justify-center gap-2 active:scale-[0.97] transition-transform"
        >
          View on Solscan
          <span className="material-symbols-outlined text-[18px]">open_in_new</span>
        </a>
        <button
          type="button"
          onClick={onNewTransfer}
          className="h-11 rounded-full bg-surface-container text-on-surface text-label-lg flex items-center justify-center"
        >
          New transfer
        </button>
        <Link
          href="/portfolio"
          className="h-11 rounded-full text-on-surface-variant text-label-lg flex items-center justify-center"
        >
          Portfolio
        </Link>
      </div>
    </motion.section>
  );
}
