'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';

// TODO(integration): Fetch wallet address from auth/wallet provider
export function DepositSection() {
  const [copied, setCopied] = useState(false);
  const depositAddress = "MockWalletAddress1234567890abcdef";
  
  const truncateAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const handleCopy = () => {
    if (!depositAddress) return;
    navigator.clipboard.writeText(depositAddress);
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
          Send USDC and a small amount of SOL (for gas) to this address from any Solana wallet or exchange.
        </p>
        
        <div className="w-full flex items-center justify-between bg-surface-container-low rounded-full p-2 pl-4 mb-4 border border-outline-variant">
          <span className="text-label-lg text-on-surface font-mono">
            {truncateAddress(depositAddress)}
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
      </div>
    </motion.section>
  );
}
