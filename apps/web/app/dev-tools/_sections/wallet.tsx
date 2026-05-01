'use client';

import { useCallback, useEffect, useState } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, USDC_MINT } from '@hunch-it/shared';
import { useWallet } from '@/lib/wallet/use-wallet';
import { Section } from '../_components/section';
import { DEV_TOOLS_TOKEN } from '../_components/token';
import * as s from '../_components/styles';

interface Balances {
  usdc: number | null;
  sol: number | null;
  wen: number | null;
}

const REFRESH_MS = 5_000;

export function WalletSection({
  onWenChange,
}: {
  onWenChange?: (wen: number | null) => void;
}) {
  const { publicKey, address, connected } = useWallet();
  const { connection } = useConnection();
  const [balances, setBalances] = useState<Balances>({ usdc: null, sol: null, wen: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!publicKey) {
      setBalances({ usdc: null, sol: null, wen: null });
      onWenChange?.(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [solLamports, splAccounts, token2022Accounts] = await Promise.all([
        connection.getBalance(publicKey),
        connection.getParsedTokenAccountsByOwner(publicKey, {
          mint: new PublicKey(USDC_MINT),
        }),
        connection.getParsedTokenAccountsByOwner(publicKey, {
          programId: new PublicKey(TOKEN_2022_PROGRAM_ID),
        }),
      ]);

      const sol = solLamports / 1_000_000_000;

      const usdcAccount = splAccounts.value[0];
      const usdcRaw =
        (usdcAccount?.account.data as unknown as {
          parsed?: { info?: { tokenAmount?: { uiAmount?: number } } };
        })?.parsed?.info?.tokenAmount?.uiAmount ?? 0;

      const wenAccount = token2022Accounts.value.find((a) => {
        const info = a.account.data;
        if ('parsed' in info && info.parsed?.info?.mint === DEV_TOOLS_TOKEN.mint) return true;
        return false;
      });
      const wenRaw =
        (wenAccount?.account.data as unknown as {
          parsed?: { info?: { tokenAmount?: { uiAmount?: number } } };
        })?.parsed?.info?.tokenAmount?.uiAmount ?? 0;

      setBalances({ usdc: usdcRaw, sol, wen: wenRaw });
      onWenChange?.(wenRaw);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [connection, publicKey, onWenChange]);

  useEffect(() => {
    void refresh();
    if (!connected) return;
    const id = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh, connected]);

  const truncated = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : null;

  return (
    <Section
      id="s1"
      title="Wallet"
      subtitle="Live balances. Refreshes every 5s while connected."
      trailing={
        <button
          style={s.buttonGhost}
          onClick={() => void refresh()}
          disabled={!connected || loading}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      }
    >
      {!connected ? (
        <div style={s.muted}>Wallet not connected. Connect from the home screen.</div>
      ) : (
        <div style={s.grid3}>
          <Field label="Address" value={truncated ?? '—'} mono onCopy={address ?? undefined} />
          <Field label="USDC" value={fmt(balances.usdc, 6)} />
          <Field label="SOL" value={fmt(balances.sol, 4)} />
          <Field
            label={`${DEV_TOOLS_TOKEN.symbol}`}
            value={fmt(balances.wen, 2)}
            highlight
          />
        </div>
      )}
      {error && <div style={s.errorText}>{error}</div>}
    </Section>
  );
}

function Field({
  label,
  value,
  mono = false,
  highlight = false,
  onCopy,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
  onCopy?: string;
}) {
  return (
    <div style={s.labelRow}>
      <span style={s.labelText}>{label}</span>
      <span
        onClick={onCopy ? () => void navigator.clipboard.writeText(onCopy) : undefined}
        style={{
          fontSize: 14,
          fontFamily: mono ? 'ui-monospace, monospace' : undefined,
          color: highlight ? 'var(--color-buy, #22c55e)' : 'var(--color-fg, #e6e6e6)',
          fontWeight: highlight ? 600 : 400,
          cursor: onCopy ? 'pointer' : undefined,
        }}
        title={onCopy ? 'Click to copy' : undefined}
      >
        {value}
      </span>
    </div>
  );
}

function fmt(n: number | null, decimals: number): string {
  if (n == null) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals });
}
