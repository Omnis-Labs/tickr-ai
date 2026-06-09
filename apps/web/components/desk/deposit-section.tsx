'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useWallet } from '@/lib/wallet/use-wallet';
import { depositAddressState } from '@/lib/desk/deposit-address-state';

export function DepositSection() {
  const { ready, connected, address } = useWallet();
  const [copied, setCopied] = useState(false);
  const addressState = depositAddressState({ ready, connected, address });

  const truncateAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  const handleCopy = () => {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.section
      id="deposit-section"
      className="mt-8 mb-12 flex flex-col gap-4"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
    >
      <h3 className="text-title-lg text-primary mb-2">Deposit</h3>

      <div className="bg-surface rounded-lg p-5 shadow-micro flex flex-col items-center text-center">
        <div className="w-12 h-12 bg-accent/20 text-accent-bright rounded-full flex items-center justify-center mb-4">
          <span className="material-symbols-outlined text-[24px]">account_balance_wallet</span>
        </div>

        <p className="text-body-md text-on-surface-variant mb-6">
          Copy your Solana wallet address. Only send Solana USDC or SOL to this address.
        </p>

        {addressState === 'loading' ? (
          <div className="w-full flex items-center justify-between bg-surface-container-low rounded-full p-2 pl-4 border border-outline-variant animate-pulse">
            <div className="h-5 w-32 rounded bg-surface-container" />
            <div className="h-9 w-20 rounded-full bg-surface-container" />
          </div>
        ) : addressState === 'address' && address ? (
          <div className="w-full flex flex-col gap-3">
            <div className="flex items-center justify-between bg-surface-container-low rounded-full p-2 pl-4 border border-outline-variant">
              <span className="text-label-lg text-on-surface font-mono">
                {truncateAddress(address)}
              </span>
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center justify-center gap-2 bg-primary text-on-primary rounded-full px-4 py-2 text-label-md hover:opacity-90 transition-opacity"
              >
                <span className="material-symbols-outlined text-[16px]">
                  {copied ? 'check' : 'content_copy'}
                </span>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div className="w-full border-t border-divider pt-3 text-left flex flex-col gap-2">
              <div className="flex items-start gap-2">
                <span className="material-symbols-outlined text-[18px] text-primary mt-0.5">
                  payments
                </span>
                <p className="text-body-sm text-on-surface-variant">
                  <span className="text-label-md text-on-surface">USDC</span> funds trades and
                  withdrawals.
                </p>
              </div>
              <div className="flex items-start gap-2">
                <span className="material-symbols-outlined text-[18px] text-primary mt-0.5">
                  bolt
                </span>
                <p className="text-body-sm text-on-surface-variant">
                  <span className="text-label-md text-on-surface">SOL</span> is required for fees
                  and withdrawals.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="w-full flex items-center justify-center bg-surface-container-low rounded-full px-4 py-3 border border-outline-variant text-body-sm text-on-surface-variant">
            Sign in to reveal your deposit address
          </div>
        )}
      </div>
    </motion.section>
  );
}
