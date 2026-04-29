'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useWallet } from '@/lib/wallet/use-wallet';

/**
 * Deposit panel on /desk. Two paths converge on the same embedded wallet:
 *   - "Fund" button → Privy on-ramp modal (card / Coinbase / external).
 *   - Address copy → user sends USDC themselves from another wallet/CEX.
 * Both target the user's connected Solana embedded wallet, which is the
 * source of truth read by readUsdcBalance() into /api/portfolio.cashUsd.
 */
export function DepositSection() {
  const { address, connected, fundWallet } = useWallet();
  const [copied, setCopied] = useState(false);
  const [funding, setFunding] = useState(false);

  const truncateAddress = (addr: string) =>
    `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  const handleCopy = () => {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleFund = async () => {
    if (!connected) return;
    setFunding(true);
    try {
      await fundWallet();
    } catch (err) {
      console.warn('[deposit] fundWallet rejected/failed', err);
    } finally {
      setFunding(false);
    }
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
          Fund with a card or copy your address and send USDC from any Solana wallet or exchange.
        </p>

        <button
          type="button"
          onClick={handleFund}
          disabled={!connected || funding}
          className="w-full mb-4 flex items-center justify-center gap-2 bg-accent text-on-accent rounded-full h-12 text-label-lg shadow-soft transition-transform active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100"
        >
          <span className="material-symbols-outlined text-[20px]">credit_card</span>
          {funding ? 'Opening…' : 'Fund with card'}
        </button>

        {address ? (
          <div className="w-full flex items-center justify-between bg-surface-container-low rounded-full p-2 pl-4 border border-outline-variant">
            <span className="text-label-lg text-on-surface font-mono">
              {truncateAddress(address)}
            </span>
            <button
              onClick={handleCopy}
              className="flex items-center justify-center gap-2 bg-primary text-on-primary rounded-full px-4 py-2 text-label-md hover:opacity-90 transition-opacity"
            >
              <span className="material-symbols-outlined text-[16px]">
                {copied ? 'check' : 'content_copy'}
              </span>
              {copied ? 'Copied!' : 'Copy'}
            </button>
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
