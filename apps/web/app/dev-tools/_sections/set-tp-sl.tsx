'use client';

import { useCallback, useEffect, useState } from 'react';
import { useWallet } from '@/lib/wallet/use-wallet';
import { useJupiterTrigger } from '@/lib/jupiter/use-jupiter-trigger';
import {
  listOrderHistory,
  type JupiterOrderHistoryEntry,
} from '@/lib/jupiter/trigger';
import { USDC_MINT } from '@hunch-it/shared';
import { Section } from '../_components/section';
import { DEV_TOOLS_TOKEN } from '../_components/token';
import * as s from '../_components/styles';

interface SetTpSlSectionProps {
  walletWenBalance: number | null;
  /** Notifies the parent so S5 can re-evaluate "exits exist" once we've placed. */
  onPlaced?: () => void;
}

/**
 * Existing exits = open SELL trigger orders on this wallet whose inputMint is
 * WEN and outputMint is USDC. We treat any single match as "TP/SL already
 * configured" (S5 handles change). Two matches means a full TP+SL pair set.
 */
function isWenExit(o: JupiterOrderHistoryEntry): boolean {
  return o.inputMint === DEV_TOOLS_TOKEN.mint && o.outputMint === USDC_MINT;
}

export function SetTpSlSection({ walletWenBalance, onPlaced }: SetTpSlSectionProps) {
  const { address, connected } = useWallet();
  const { placeSellExit, loading } = useJupiterTrigger();
  const [tp, setTp] = useState('');
  const [sl, setSl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [existingExits, setExistingExits] = useState<JupiterOrderHistoryEntry[]>([]);
  const [checking, setChecking] = useState(false);

  const refreshExits = useCallback(async () => {
    if (!address) return;
    setChecking(true);
    try {
      const rows = await listOrderHistory({
        wallet: address,
        statuses: ['OPEN', 'PARTIALLY_FILLED'],
      });
      setExistingExits(rows.filter(isWenExit));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  }, [address]);

  useEffect(() => {
    if (!connected) return;
    void refreshExits();
  }, [connected, refreshExits]);

  const tpNum = Number(tp);
  const slNum = Number(sl);
  const validation = (() => {
    if (!connected) return 'Wallet not connected.';
    if (!walletWenBalance || walletWenBalance <= 0) return `No ${DEV_TOOLS_TOKEN.symbol} balance.`;
    if (!Number.isFinite(tpNum) || tpNum <= 0) return 'Enter a positive TP price.';
    if (!Number.isFinite(slNum) || slNum <= 0) return 'Enter a positive SL price.';
    if (tpNum <= slNum) return 'TP must be greater than SL.';
    return null;
  })();

  async function handleSet() {
    if (validation || !walletWenBalance) {
      setError(validation);
      return;
    }
    setError(null);
    setSuccess(null);
    try {
      // Phase A: place TP (above)
      await placeSellExit({
        inputMint: DEV_TOOLS_TOKEN.mint,
        inputDecimals: DEV_TOOLS_TOKEN.decimals,
        tokenAmount: walletWenBalance,
        triggerPriceUsd: tpNum,
        triggerCondition: 'above',
      });
      // Phase B: place SL (below)
      await placeSellExit({
        inputMint: DEV_TOOLS_TOKEN.mint,
        inputDecimals: DEV_TOOLS_TOKEN.decimals,
        tokenAmount: walletWenBalance,
        triggerPriceUsd: slNum,
        triggerCondition: 'below',
      });
      setSuccess(`TP @ $${tpNum} and SL @ $${slNum} placed.`);
      void refreshExits();
      onPlaced?.();
    } catch (err) {
      setError(`Phase failed: ${err instanceof Error ? err.message : String(err)}`);
      void refreshExits();
    }
  }

  if (existingExits.length > 0) {
    return (
      <Section
        id="s4"
        title="Set TP/SL"
        subtitle="Hidden — exits already configured. Use S5 to change."
      >
        <div style={s.muted}>
          Found {existingExits.length} open exit order
          {existingExits.length === 1 ? '' : 's'}. Skip to{' '}
          <a href="#s5" style={{ color: 'var(--color-accent, #4f46e5)' }}>
            S5
          </a>
          .
        </div>
      </Section>
    );
  }

  return (
    <Section
      id="s4"
      title="Set TP/SL (initial)"
      subtitle="Both legs required. Places TP (above) then SL (below) sequentially."
      trailing={
        <button
          style={s.buttonGhost}
          onClick={() => void refreshExits()}
          disabled={checking}
        >
          {checking ? 'Checking…' : 'Re-check'}
        </button>
      }
    >
      {!walletWenBalance || walletWenBalance <= 0 ? (
        <div style={s.muted}>
          No {DEV_TOOLS_TOKEN.symbol} balance — buy first via S2 or S3.
        </div>
      ) : (
        <>
          <div style={{ ...s.muted, marginBottom: 8 }}>
            Will sell {walletWenBalance.toFixed(2)} {DEV_TOOLS_TOKEN.symbol} at each trigger.
          </div>
          <div style={s.grid2}>
            <div style={s.labelRow}>
              <label style={s.labelText} htmlFor="dev-tp">
                Take-Profit (USD)
              </label>
              <input
                id="dev-tp"
                style={s.input}
                type="number"
                min="0"
                step="0.000001"
                value={tp}
                onChange={(e) => setTp(e.target.value)}
              />
            </div>
            <div style={s.labelRow}>
              <label style={s.labelText} htmlFor="dev-sl">
                Stop-Loss (USD)
              </label>
              <input
                id="dev-sl"
                style={s.input}
                type="number"
                min="0"
                step="0.000001"
                value={sl}
                onChange={(e) => setSl(e.target.value)}
              />
            </div>
          </div>
          <button
            style={{ ...s.button, marginTop: 12 }}
            onClick={() => void handleSet()}
            disabled={!!validation || !!loading}
          >
            {loading ? `Placing… (${loading})` : 'Set TP & SL'}
          </button>
          {validation && !error && <div style={s.errorText}>{validation}</div>}
          {error && <div style={s.errorText}>{error}</div>}
          {success && <div style={s.okText}>{success}</div>}
        </>
      )}
    </Section>
  );
}
