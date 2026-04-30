'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { Signal } from '@hunch-it/shared';
import { SignalModal } from '@/components/signal-modal/signal-modal';
import { useSignalsStore } from '@/lib/store/signals';

export default function SignalDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const inMemory = useSignalsStore((s) =>
    params?.id ? s.signalsById[params.id] : undefined,
  );
  const removeSignal = useSignalsStore((s) => s.removeSignal);
  const [coldRead, setColdRead] = useState<Signal | null>(null);
  const [loaded, setLoaded] = useState(false);

  // If we don't have it in the in-memory store, fall back to GET /api/signals/:id
  // which checks Postgres → Redis → 404. Keeps shared links and refreshes working.
  useEffect(() => {
    if (!params?.id || inMemory) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    fetch(`/api/signals/${params.id}`)
      .then(async (r) => (r.ok ? ((await r.json()) as { signal: Signal }) : null))
      .then((j) => {
        if (!cancelled && j?.signal) setColdRead(j.signal);
        if (!cancelled) setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [params?.id, inMemory]);

  const signal = inMemory ?? coldRead ?? null;

  function handleClose(decision: boolean | null) {
    if (params?.id && inMemory) removeSignal(params.id);
    router.replace('/');
    void decision;
  }

  if (!loaded) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          color: 'var(--color-fg-muted)',
        }}
      >
        Loading signal…
      </div>
    );
  }

  return <SignalModal signal={signal} fallbackId={params?.id} onClose={handleClose} />;
}
