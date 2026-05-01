'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { USDC_MINT, solscanTokenUrl } from '@hunch-it/shared';
import { useWallet } from '@/lib/wallet/use-wallet';
import { useJupiterTrigger } from '@/lib/jupiter/use-jupiter-trigger';
import {
  deriveTriggerCondition,
  listOrderHistory,
  type JupiterOrderHistoryEntry,
} from '@/lib/jupiter/trigger';
import { useAuthedFetch } from '@/lib/auth/fetch';
import { usePythPrice } from '@/lib/hooks/use-pyth-price';
import { Section } from '../_components/section';
import { DEV_TOOLS_TOKEN, TRIGGER_DEFAULTS } from '../_components/token';
import * as s from '../_components/styles';

interface PlacedState {
  jupiterOrderId: string;
  txSignature: string;
}

interface ResolvedModalState {
  jupiterOrderId: string;
  status: string;
  rawState?: string;
  filledAmount?: string;
  outAmount?: string;
}

const POLL_MS = 3_000;
const MIN_SOL = 0.005;

export function TriggerBuySection({ onResolved }: { onResolved?: () => void }) {
  const { address, publicKey, connected } = useWallet();
  const { connection } = useConnection();
  const authedFetch = useAuthedFetch();
  const { placeBuy, loading } = useJupiterTrigger();
  const { price: livePrice, publishTime } = usePythPrice(DEV_TOOLS_TOKEN.pythFeedId, 1_000);

  const [usdAmount, setUsdAmount] = useState('1');
  const [triggerPrice, setTriggerPrice] = useState('');
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // `placed` drives polling; `showPlacedModal` drives the placed-modal UI.
  // Decoupled so the user dismissing the placed modal doesn't kill polling.
  const [placed, setPlaced] = useState<PlacedState | null>(null);
  const [showPlacedModal, setShowPlacedModal] = useState(false);
  const [resolved, setResolved] = useState<ResolvedModalState | null>(null);
  const [productionOrders, setProductionOrders] = useState<unknown[]>([]);
  const [history, setHistory] = useState<JupiterOrderHistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const placingRef = useRef(false);

  // Read USDC + SOL balances directly so the validation block stays
  // self-contained — S1 already shows them but we want our own snapshot
  // at place-time.
  const refreshOwnBalances = useCallback(async () => {
    if (!publicKey) {
      setUsdcBalance(null);
      setSolBalance(null);
      return;
    }
    try {
      const [solLamports, usdcAccounts] = await Promise.all([
        connection.getBalance(publicKey),
        connection.getParsedTokenAccountsByOwner(publicKey, {
          mint: new PublicKey(USDC_MINT),
        }),
      ]);
      setSolBalance(solLamports / LAMPORTS_PER_SOL);
      const usdc = usdcAccounts.value[0];
      const ui =
        (usdc?.account.data as unknown as {
          parsed?: { info?: { tokenAmount?: { uiAmount?: number } } };
        })?.parsed?.info?.tokenAmount?.uiAmount ?? 0;
      setUsdcBalance(ui);
    } catch {
      // best effort — validation only
    }
  }, [connection, publicKey]);

  useEffect(() => {
    void refreshOwnBalances();
  }, [refreshOwnBalances]);

  const refreshHistory = useCallback(async () => {
    if (!address) return;
    setLoadingHistory(true);
    try {
      const rows = await listOrderHistory({ wallet: address });
      setHistory(rows);
    } catch (err) {
      setError(`history fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoadingHistory(false);
    }
  }, [address]);

  const refreshProductionOrders = useCallback(async () => {
    try {
      const r = await authedFetch('/api/orders');
      const j = (await r.json().catch(() => ({}))) as { orders?: unknown[] };
      setProductionOrders(j.orders ?? []);
    } catch {
      setProductionOrders([]);
    }
  }, [authedFetch]);

  useEffect(() => {
    if (!connected) return;
    void refreshHistory();
    void refreshProductionOrders();
  }, [connected, refreshHistory, refreshProductionOrders]);

  const usd = Number(usdAmount);
  const trigger = Number(triggerPrice);
  const validationError = (() => {
    if (!connected) return 'Wallet not connected.';
    if (!Number.isFinite(usd) || usd <= 0) return 'Enter a positive USD amount.';
    if (!Number.isFinite(trigger) || trigger <= 0) return 'Enter a positive trigger price.';
    if (usdcBalance != null && usdcBalance < usd) {
      return `USDC balance (${usdcBalance.toFixed(2)}) below order size.`;
    }
    if (solBalance != null && solBalance < MIN_SOL) {
      return `SOL balance (${solBalance.toFixed(4)}) below ${MIN_SOL} required for fees.`;
    }
    // Live price is required to derive the trigger condition correctly. Without
    // it, a dip-buy trigger could silently flip to a breakout-buy during a
    // Pyth/Hermes outage.
    if (livePrice == null) return 'Waiting for live Pyth price (Hermes).';
    return null;
  })();

  async function handlePlace() {
    if (placingRef.current) return;
    if (validationError) {
      setError(validationError);
      return;
    }
    if (livePrice == null) return; // belt-and-suspenders; validation should have caught
    placingRef.current = true;
    setError(null);
    try {
      const expiresAt = Math.floor(Date.now() / 1000) + TRIGGER_DEFAULTS.expirySeconds;
      const result = await placeBuy({
        outputMint: DEV_TOOLS_TOKEN.mint,
        usdAmount: usd,
        triggerPriceUsd: trigger,
        triggerCondition: deriveTriggerCondition(trigger, livePrice),
        slippageBps: TRIGGER_DEFAULTS.slippageBps,
        expiresAt,
      });
      setPlaced({ jupiterOrderId: result.id, txSignature: result.txSignature });
      setShowPlacedModal(true);
      void refreshHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      placingRef.current = false;
    }
  }

  // Polling loop while a `placed` order is in flight. Driven by `placed`,
  // not by modal visibility — the user can dismiss the placed-modal and
  // polling continues in the background until terminal state.
  useEffect(() => {
    if (!placed || resolved) return;
    let cancelled = false;
    const tick = async () => {
      if (!address) return;
      try {
        const rows = await listOrderHistory({ wallet: address });
        const match = rows.find((o) => o.id === placed.jupiterOrderId);
        if (!match) return;
        const terminal: ReadonlyArray<string> = [
          'FILLED',
          'CANCELLED',
          'EXPIRED',
          'FAILED',
        ];
        if (terminal.includes(match.status)) {
          if (cancelled) return;
          setResolved({
            jupiterOrderId: match.id,
            status: match.status,
            rawState: match.rawState,
            filledAmount: match.filledAmount,
            outAmount: match.outAmount,
          });
          setHistory(rows);
          // Defer cross-section refresh to resolution-modal close — bumping
          // bump now would re-mount sister sections while user is still
          // reading the resolution modal.
        }
      } catch {
        // transient — keep polling
      }
    };
    void tick();
    const id = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [placed, resolved, address]);

  const placeButtonLabel = (() => {
    switch (loading) {
      case 'vault':
        return 'Resolving vault…';
      case 'craft':
        return 'Crafting deposit…';
      case 'sign':
        return 'Awaiting signature…';
      case 'submit':
        return 'Submitting…';
      default:
        return 'Place trigger BUY';
    }
  })();

  return (
    <Section
      id="s2"
      title={`Trigger BUY · ${DEV_TOOLS_TOKEN.symbol}`}
      subtitle="Real Jupiter Trigger Order v2. Auto-derived condition. Slippage 50 bps. Expiry 60s."
      trailing={
        <a
          href={solscanTokenUrl(DEV_TOOLS_TOKEN.mint)}
          target="_blank"
          rel="noreferrer"
          style={{ ...s.muted, fontSize: 11 }}
        >
          {DEV_TOOLS_TOKEN.mint.slice(0, 6)}… ↗
        </a>
      }
    >
      <div style={{ ...s.flexRow, justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div style={s.labelText}>Live Pyth WEN/USD</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>
            {livePrice != null ? `$${livePrice.toFixed(6)}` : '—'}
          </div>
          {publishTime && (
            <div style={s.muted}>
              {new Date(publishTime * 1000).toLocaleTimeString()}
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={s.labelText}>USDC / SOL</div>
          <div style={{ fontSize: 13 }}>
            {usdcBalance != null ? usdcBalance.toFixed(2) : '—'} /{' '}
            {solBalance != null ? solBalance.toFixed(4) : '—'}
          </div>
        </div>
      </div>

      <div style={s.grid2}>
        <div style={s.labelRow}>
          <label style={s.labelText} htmlFor="dev-buy-usd">
            USD Amount
          </label>
          <input
            id="dev-buy-usd"
            style={s.input}
            type="number"
            min="0.01"
            step="0.01"
            value={usdAmount}
            onChange={(e) => setUsdAmount(e.target.value)}
            placeholder="1"
          />
        </div>
        <div style={s.labelRow}>
          <label style={s.labelText} htmlFor="dev-buy-trigger">
            Trigger Price (USD)
          </label>
          <input
            id="dev-buy-trigger"
            style={s.input}
            type="number"
            min="0"
            step="0.000001"
            value={triggerPrice}
            onChange={(e) => setTriggerPrice(e.target.value)}
            placeholder="0.04"
          />
        </div>
      </div>

      <button
        style={{ ...s.button, marginTop: 12, opacity: validationError ? 0.5 : 1 }}
        onClick={() => void handlePlace()}
        disabled={!!validationError || !!loading || placingRef.current}
      >
        {placeButtonLabel}
      </button>
      {validationError && !error && <div style={s.errorText}>{validationError}</div>}
      {error && <div style={s.errorText}>{error}</div>}

      {showPlacedModal && placed && !resolved && (
        <Modal
          title="Order placed — polling for resolution"
          onClose={() => setShowPlacedModal(false)}
          variant="info"
        >
          <KV k="orderId" v={placed.jupiterOrderId} mono />
          <KV
            k="tx"
            v={
              <a
                href={`https://solscan.io/tx/${placed.txSignature}`}
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--color-accent, #4f46e5)' }}
              >
                {placed.txSignature.slice(0, 12)}… ↗
              </a>
            }
          />
          <div style={{ ...s.muted, marginTop: 8 }}>
            Polling every {POLL_MS / 1000}s in the background. You can close this and
            keep using the page; the resolution modal will appear when terminal.
          </div>
        </Modal>
      )}

      {resolved && (
        <Modal
          title={`Resolved · ${resolved.status}`}
          onClose={() => {
            setPlaced(null);
            setShowPlacedModal(false);
            setResolved(null);
            onResolved?.();
          }}
          variant={resolved.status === 'FILLED' ? 'ok' : 'warn'}
        >
          <KV k="orderId" v={resolved.jupiterOrderId} mono />
          <KV k="status" v={resolved.status} />
          {resolved.rawState && <KV k="rawState" v={resolved.rawState} />}
          {resolved.filledAmount && <KV k="filledAmount" v={resolved.filledAmount} />}
          {resolved.outAmount && <KV k="outAmount" v={resolved.outAmount} />}
        </Modal>
      )}

      <div style={{ marginTop: 24 }}>
        <div style={{ ...s.flexRow, justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={s.labelText}>Production Orders (DB) · /api/orders</span>
          <button style={s.buttonGhost} onClick={() => void refreshProductionOrders()}>
            Refresh
          </button>
        </div>
        <div style={s.muted}>
          dev-tools orders do not appear here — see <code style={s.code}>WEN</code> wallet
          balance and S4–S6 instead.
        </div>
        <pre style={{ ...s.pre, marginTop: 6, maxHeight: 160 }}>
          {JSON.stringify(productionOrders, null, 2)}
        </pre>
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{ ...s.flexRow, justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={s.labelText}>
            All Trigger Orders (Jupiter, read-only) · {history.length}
          </span>
          <button
            style={s.buttonGhost}
            onClick={() => void refreshHistory()}
            disabled={loadingHistory}
          >
            {loadingHistory ? 'Loading…' : 'Refresh'}
          </button>
        </div>
        <pre style={{ ...s.pre, maxHeight: 240 }}>
          {history.length === 0
            ? '(no orders)'
            : JSON.stringify(
                history.map((o) => ({
                  id: o.id.slice(0, 8) + '…',
                  status: o.status,
                  rawState: o.rawState,
                  inputMint: o.inputMint?.slice(0, 6),
                  outputMint: o.outputMint?.slice(0, 6),
                  trigger: o.triggerPriceUsd,
                  fill: o.fillPercent,
                })),
                null,
                2,
              )}
        </pre>
      </div>
    </Section>
  );
}

function Modal({
  title,
  children,
  onClose,
  variant,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  variant: 'info' | 'ok' | 'warn';
}) {
  const accent =
    variant === 'ok' ? '#22c55e' : variant === 'warn' ? '#f59e0b' : '#4f46e5';
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(4px)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 9999,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#0e1118',
          border: `1px solid ${accent}`,
          borderRadius: 12,
          padding: 20,
          maxWidth: 480,
          width: '90%',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            color: accent,
            marginBottom: 12,
          }}
        >
          {title}
        </div>
        {children}
        <button style={{ ...s.buttonGhost, marginTop: 12 }} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

function KV({ k, v, mono = false }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div style={{ ...s.flexRow, marginBottom: 4, alignItems: 'flex-start' }}>
      <span style={{ ...s.labelText, minWidth: 90 }}>{k}</span>
      <span
        style={{
          fontSize: 12,
          fontFamily: mono ? 'ui-monospace, monospace' : undefined,
          wordBreak: 'break-all',
          color: 'var(--color-fg, #e6e6e6)',
        }}
      >
        {v}
      </span>
    </div>
  );
}
