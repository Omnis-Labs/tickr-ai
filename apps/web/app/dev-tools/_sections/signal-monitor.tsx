'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSharedWorker } from '@/lib/shared-worker/use-shared-worker';
import { useWallet } from '@/lib/wallet/use-wallet';
import { Section } from '../_components/section';
import * as s from '../_components/styles';

interface LogEntry {
  /** Stable per-entry id so the per-row expansion state stays attached to
   *  the same event when the list shifts (newest is prepended). */
  id: string;
  ts: number;
  event: string;
  payload: unknown;
}

const MAX_LOG = 200;

export function SignalMonitorSection() {
  const { address, connected: walletConnected } = useWallet();
  const [paused, setPaused] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const counterRef = useRef(0);

  const onAnyEvent = useCallback((event: string, ...args: unknown[]) => {
    if (pausedRef.current) return;
    const payload = args.length === 0 ? null : args.length === 1 ? args[0] : args;
    setLog((prev) => {
      const ts = Date.now();
      const id = `${ts}-${counterRef.current++}`;
      const next: LogEntry = { id, ts, event, payload };
      const out = [next, ...prev];
      return out.length > MAX_LOG ? out.slice(0, MAX_LOG) : out;
    });
  }, []);

  const { connected: socketConnected } = useSharedWorker({
    walletAddress: address ?? undefined,
    onAnyEvent,
  });

  // useSharedWorker doesn't expose an auth-error signal distinct from
  // disconnected, so we collapse to three states. If/when it does, add
  // 'auth-error' between connecting and connected.
  const status: 'disconnected' | 'connecting' | 'connected' = (() => {
    if (!walletConnected) return 'disconnected';
    if (!socketConnected) return 'connecting';
    return 'connected';
  })();

  const statusColor =
    status === 'connected'
      ? '#22c55e'
      : status === 'connecting'
        ? '#f59e0b'
        : '#888';

  return (
    <Section
      id="s7"
      title="Signal Monitor"
      subtitle="Live tap into the production socket. Newest event on top. Engine.IO pings excluded."
      trailing={
        <div style={{ ...s.flexRow, gap: 8 }}>
          <span style={s.badge(statusColor)}>{status}</span>
          <button
            style={s.buttonGhost}
            onClick={() => setPaused((p) => !p)}
            disabled={!walletConnected}
          >
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button style={s.buttonGhost} onClick={() => setLog([])}>
            Clear
          </button>
        </div>
      }
    >
      {!walletConnected ? (
        <div style={s.muted}>Wallet not connected — socket needs Privy auth.</div>
      ) : (
        <>
          <div style={{ ...s.muted, marginBottom: 6 }}>
            {log.length} event{log.length === 1 ? '' : 's'} (cap {MAX_LOG}).
          </div>
          <div
            style={{
              maxHeight: 320,
              overflowY: 'auto',
              border: '1px solid var(--color-border, #2a3142)',
              borderRadius: 6,
              background: 'var(--color-bg-muted, #1a1f2e)',
            }}
          >
            {log.length === 0 ? (
              <div style={{ ...s.muted, padding: 12 }}>
                Waiting for events… (page load typically yields a `connect` + auth flow.)
              </div>
            ) : (
              log.map((entry) => <Row key={entry.id} entry={entry} />)
            )}
          </div>
        </>
      )}
    </Section>
  );
}

function Row({ entry }: { entry: LogEntry }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      onClick={() => setExpanded((v) => !v)}
      style={{
        padding: '6px 10px',
        borderBottom: '1px solid var(--color-border, #2a3142)',
        cursor: 'pointer',
        fontFamily: 'ui-monospace, monospace',
        fontSize: 11,
      }}
    >
      <div style={{ ...s.flexRow, justifyContent: 'space-between' }}>
        <span style={{ fontWeight: 600, color: 'var(--color-fg, #e6e6e6)' }}>
          {entry.event}
        </span>
        <span style={s.muted}>{new Date(entry.ts).toLocaleTimeString()}</span>
      </div>
      {expanded && (
        <pre style={{ ...s.pre, marginTop: 4, maxHeight: 160 }}>
          {entry.payload === null
            ? '(no payload)'
            : safeStringify(entry.payload)}
        </pre>
      )}
    </div>
  );
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
