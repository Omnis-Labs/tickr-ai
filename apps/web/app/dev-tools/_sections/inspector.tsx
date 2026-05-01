'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuthedFetch } from '@/lib/auth/fetch';
import { isDemo } from '@/lib/demo/flag';
import { Section } from '../_components/section';
import * as s from '../_components/styles';

interface TabSpec {
  id: string;
  label: string;
  url: string;
}

const TABS: TabSpec[] = [
  { id: 'me', label: 'GET /api/users/me', url: '/api/users/me' },
  { id: 'mandates', label: 'GET /api/mandates', url: '/api/mandates' },
  { id: 'portfolio', label: 'GET /api/portfolio', url: '/api/portfolio' },
  { id: 'positions', label: 'GET /api/positions', url: '/api/positions' },
  { id: 'proposals', label: 'GET /api/proposals', url: '/api/proposals' },
];

export function InspectorSection() {
  const authedFetch = useAuthedFetch();
  const [active, setActive] = useState<string>(TABS[0]!.id);
  const [data, setData] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  const refresh = useCallback(
    async (tabId: string) => {
      const tab = TABS.find((t) => t.id === tabId);
      if (!tab) return;
      setLoading((p) => ({ ...p, [tabId]: true }));
      setError((p) => ({ ...p, [tabId]: '' }));
      try {
        const r = await authedFetch(tab.url);
        const text = await r.text();
        let parsed: unknown = text;
        try {
          parsed = JSON.parse(text);
        } catch {
          // already a string
        }
        if (!r.ok) {
          setError((p) => ({ ...p, [tabId]: `HTTP ${r.status} ${r.statusText}` }));
        }
        setData((p) => ({ ...p, [tabId]: parsed }));
      } catch (err) {
        setError((p) => ({
          ...p,
          [tabId]: err instanceof Error ? err.message : String(err),
        }));
      } finally {
        setLoading((p) => ({ ...p, [tabId]: false }));
      }
    },
    [authedFetch],
  );

  useEffect(() => {
    void refresh(active);
  }, [active, refresh]);

  return (
    <Section
      id="s9"
      title="Inspector"
      subtitle="Read-only dump of authenticated API endpoints. Uses Privy bearer via useAuthedFetch."
    >
      {isDemo() && (
        <div
          style={{
            background: 'rgba(245, 158, 11, 0.15)',
            border: '1px solid #f59e0b',
            color: '#f59e0b',
            padding: 8,
            borderRadius: 6,
            fontSize: 12,
            marginBottom: 10,
          }}
        >
          Demo mode — endpoints return fixture data, not your live account.
        </div>
      )}
      <div style={{ ...s.flexRow, flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            style={{
              ...s.buttonGhost,
              fontSize: 11,
              padding: '4px 8px',
              borderColor: active === t.id ? '#4f46e5' : undefined,
              color: active === t.id ? 'var(--color-fg, #e6e6e6)' : undefined,
            }}
            onClick={() => setActive(t.id)}
          >
            {t.label}
          </button>
        ))}
        <button
          style={{ ...s.buttonGhost, fontSize: 11, padding: '4px 8px', marginLeft: 'auto' }}
          onClick={() => void refresh(active)}
          disabled={loading[active]}
        >
          {loading[active] ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      {error[active] && <div style={s.errorText}>{error[active]}</div>}
      <pre style={{ ...s.pre, maxHeight: 360 }}>
        {data[active] === undefined
          ? '(no data yet)'
          : typeof data[active] === 'string'
            ? (data[active] as string)
            : JSON.stringify(data[active], null, 2)}
      </pre>
    </Section>
  );
}
