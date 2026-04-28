'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  HOLDING_PERIOD_OPTIONS,
  MARKET_FOCUS_VERTICALS,
  MAX_DRAWDOWN_OPTIONS,
  type Mandate,
} from '@hunch-it/shared';
import { useWallet } from '@/lib/wallet/use-wallet';
import { isDemo } from '@/lib/demo';

interface MandateResponse {
  mandate: Mandate | null;
}

function shorten(addr: string): string {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

export default function SettingsPage() {
  const demo = isDemo();
  const { address, connected, logout } = useWallet();
  const wallet = demo ? 'demo-wallet' : address;

  const { data, isLoading } = useQuery<MandateResponse>({
    queryKey: ['mandate', wallet],
    queryFn: async () => {
      if (!wallet) return { mandate: null };
      const r = await fetch(`/api/mandates?wallet=${wallet}`);
      if (!r.ok) return { mandate: null };
      return r.json();
    },
    enabled: !!wallet,
  });

  const mandate = data?.mandate;
  const verticalLabels = (mandate?.marketFocus ?? []).map(
    (id) => MARKET_FOCUS_VERTICALS.find((v) => v.id === id)?.label ?? id,
  );

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px' }}>
      <Link href="/" style={{ color: 'var(--color-fg-muted)', fontSize: 13 }}>
        ← Home
      </Link>
      <motion.h1
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        style={{ fontSize: 32, fontWeight: 800, margin: '16px 0 24px' }}
      >
        Settings
      </motion.h1>

      {/* Account */}
      <Card title="Account">
        {!connected && !demo ? (
          <p style={{ color: 'var(--color-fg-muted)' }}>Not connected.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Row label="Wallet">
              <code style={{ fontSize: 12 }}>{address ?? 'demo-wallet'}</code>
            </Row>
            <Row label="Mode">{demo ? 'Demo' : 'Live'}</Row>
          </div>
        )}
        {!demo && connected && (
          <button
            className="btn btn-ghost"
            style={{ marginTop: 16 }}
            onClick={() => void logout()}
          >
            Sign out
          </button>
        )}
      </Card>

      {/* Mandate */}
      <Card title="Mandate" right={<Link href="/mandate" className="btn btn-ghost">Edit</Link>}>
        {isLoading && <p style={{ color: 'var(--color-fg-muted)' }}>Loading…</p>}
        {!isLoading && !mandate && (
          <div>
            <p style={{ color: 'var(--color-fg-muted)', marginBottom: 12 }}>
              No mandate yet. Without a mandate the signal engine doesn't generate proposals.
            </p>
            <Link href="/mandate" className="btn btn-primary">
              Set up mandate
            </Link>
          </div>
        )}
        {mandate && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Row label="Holding period">
              {HOLDING_PERIOD_OPTIONS.find((o) => o.value === mandate.holdingPeriod)?.label ??
                mandate.holdingPeriod}
              <span style={{ color: 'var(--color-fg-muted)', marginLeft: 8 }}>
                {HOLDING_PERIOD_OPTIONS.find((o) => o.value === mandate.holdingPeriod)?.caption ??
                  ''}
              </span>
            </Row>
            <Row label="Max drawdown">
              {MAX_DRAWDOWN_OPTIONS.find((o) => o.value === mandate.maxDrawdown)?.label ??
                'Custom'}
            </Row>
            <Row label="Max trade size">${mandate.maxTradeSize.toFixed(2)}</Row>
            <Row label="Market focus">{verticalLabels.join(', ') || '—'}</Row>
          </div>
        )}
        {mandate && (
          <p
            style={{
              color: 'var(--color-fg-muted)',
              fontSize: 12,
              marginTop: 12,
              borderTop: '1px solid var(--color-border)',
              paddingTop: 12,
            }}
          >
            Editing the mandate will mark every active proposal as expired and the engine will
            regenerate against the new parameters on its next cycle.
          </p>
        )}
      </Card>
    </main>
  );
}

function Card({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      className="card"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      style={{ marginBottom: 16 }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>{title}</h2>
        {right}
      </div>
      {children}
    </motion.div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <span style={{ color: 'var(--color-fg-muted)', fontSize: 13 }}>{label}</span>
      <span style={{ textAlign: 'right' }}>{children}</span>
    </div>
  );
}
