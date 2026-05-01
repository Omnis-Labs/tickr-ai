'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  PYTH_HERMES_DEFAULT_URL,
  USDC_MINT,
  parseRpcUrls,
} from '@hunch-it/shared';
import { Section } from '../_components/section';
import { DEV_TOOLS_TOKEN } from '../_components/token';
import * as s from '../_components/styles';

type Status = 'idle' | 'pending' | 'ok' | 'cors' | 'error';

interface CheckRow {
  id: string;
  label: string;
  url: string;
  redactedUrl?: string;
  status: Status;
  detail?: string;
  ms?: number;
}

function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.username || u.password) {
      u.username = u.username && '***';
      u.password = u.password && '***';
    }
    if (u.searchParams.has('api-key')) u.searchParams.set('api-key', '***');
    if (u.searchParams.has('apiKey')) u.searchParams.set('apiKey', '***');
    return u.toString();
  } catch {
    return url;
  }
}

const JUPITER_BASE =
  process.env.NEXT_PUBLIC_JUPITER_API_BASE ?? 'https://lite-api.jup.ag';
const JUPITER_TRIGGER_BASE =
  process.env.NEXT_PUBLIC_JUPITER_TRIGGER_API_BASE ?? 'https://api.jup.ag';
const APP_BASE = typeof window === 'undefined' ? '' : window.location.origin;

function buildChecks(): CheckRow[] {
  const rpcUrls = parseRpcUrls(process.env.NEXT_PUBLIC_SOLANA_RPC_URLS);
  const checks: CheckRow[] = [
    {
      id: 'jupiter-ultra',
      label: 'Jupiter Lite (Ultra quote)',
      url: `${JUPITER_BASE}/ultra/v1/order?inputMint=${USDC_MINT}&outputMint=${DEV_TOOLS_TOKEN.mint}&amount=1000000&taker=11111111111111111111111111111111`,
      status: 'idle',
    },
    {
      id: 'jupiter-trigger',
      label: 'Jupiter Trigger v2 (history probe)',
      url: `${JUPITER_TRIGGER_BASE}/trigger/v2/orders/history?user=11111111111111111111111111111111&state=active&limit=1&offset=0`,
      status: 'idle',
    },
    {
      id: 'pyth-hermes',
      label: 'Pyth Hermes (WEN feed)',
      url: `${PYTH_HERMES_DEFAULT_URL}/v2/updates/price/latest?ids[]=${DEV_TOOLS_TOKEN.pythFeedId}`,
      status: 'idle',
    },
    {
      id: 'pyth-benchmarks',
      label: 'Pyth Benchmarks (via /api/bars proxy)',
      url: `${APP_BASE}/api/bars/AAPL?resolution=5&hours=1`,
      status: 'idle',
    },
  ];

  for (let i = 0; i < rpcUrls.length; i++) {
    const url = rpcUrls[i]!;
    checks.push({
      id: `solana-rpc-${i}`,
      label: `Solana RPC #${i + 1}`,
      url,
      redactedUrl: redactUrl(url),
      status: 'idle',
    });
  }

  return checks.map((c) => ({ ...c, redactedUrl: c.redactedUrl ?? c.url }));
}

async function probe(row: CheckRow): Promise<CheckRow> {
  const start = performance.now();
  try {
    if (row.id.startsWith('solana-rpc-')) {
      const res = await fetch(row.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
      });
      const ms = Math.round(performance.now() - start);
      if (!res.ok) {
        return { ...row, status: 'error', detail: `HTTP ${res.status}`, ms };
      }
      const body = (await res.json().catch(() => null)) as
        | { result?: string; error?: { message?: string } }
        | null;
      if (body?.result === 'ok') return { ...row, status: 'ok', ms };
      return {
        ...row,
        status: 'error',
        detail: body?.error?.message ?? 'unexpected response',
        ms,
      };
    }

    const res = await fetch(row.url, { method: 'GET' });
    const ms = Math.round(performance.now() - start);
    if (res.ok) return { ...row, status: 'ok', ms, detail: `HTTP ${res.status}` };
    return { ...row, status: 'error', ms, detail: `HTTP ${res.status}` };
  } catch (err) {
    const ms = Math.round(performance.now() - start);
    const msg = err instanceof Error ? err.message : String(err);
    if (/CORS|Failed to fetch|TypeError/i.test(msg)) {
      return { ...row, status: 'cors', detail: 'CORS blocked from browser', ms };
    }
    return { ...row, status: 'error', detail: msg, ms };
  }
}

export function ConnectivitySection() {
  const [rows, setRows] = useState<CheckRow[]>(() => buildChecks());

  const runAll = useCallback(async () => {
    setRows((prev) => prev.map((r) => ({ ...r, status: 'pending' as const })));
    const checks = buildChecks();
    const results = await Promise.all(checks.map((c) => probe(c)));
    setRows(results);
  }, []);

  useEffect(() => {
    void runAll();
  }, [runAll]);

  return (
    <Section
      id="s8"
      title="External Connectivity"
      subtitle="Browser-side reachability probes. CORS-blocked services show as inconclusive."
      trailing={
        <button style={s.buttonGhost} onClick={() => void runAll()}>
          Re-run
        </button>
      }
    >
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 12,
        }}
      >
        <thead>
          <tr style={{ textAlign: 'left' }}>
            <th style={th}>Service</th>
            <th style={th}>Status</th>
            <th style={th}>Latency</th>
            <th style={th}>Detail</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ borderTop: '1px solid var(--color-border, #2a3142)' }}>
              <td style={td}>
                <div>{r.label}</div>
                <div style={{ ...s.muted, fontSize: 10, fontFamily: 'ui-monospace' }}>
                  {r.redactedUrl ?? r.url}
                </div>
              </td>
              <td style={td}>
                <span style={s.badge(statusColor(r.status))}>{r.status}</span>
              </td>
              <td style={td}>{r.ms != null ? `${r.ms}ms` : '—'}</td>
              <td style={{ ...td, ...s.muted, fontSize: 11 }}>{r.detail ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

const th: React.CSSProperties = {
  padding: '4px 6px',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: 'var(--color-fg-muted, #888)',
  fontWeight: 600,
};

const td: React.CSSProperties = {
  padding: '6px',
  verticalAlign: 'top',
};

function statusColor(status: Status): string {
  switch (status) {
    case 'ok':
      return '#22c55e';
    case 'pending':
      return '#f59e0b';
    case 'cors':
      return '#888';
    case 'error':
      return '#ef4444';
    default:
      return '#444';
  }
}
