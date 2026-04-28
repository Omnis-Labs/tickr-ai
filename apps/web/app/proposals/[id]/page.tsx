'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ProposalModal } from '@/components/proposal-modal/proposal-modal';
import { useProposalsStore, type ProposalUI } from '@/lib/store/proposals';
import { useAuthedFetch } from '@/lib/auth/fetch';

export default function ProposalDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const inMemory = useProposalsStore((s) =>
    params?.id ? s.proposalsById[params.id] : undefined,
  );
  const removeProposal = useProposalsStore((s) => s.removeProposal);
  const [coldRead, setColdRead] = useState<ProposalUI | null>(null);
  const [loaded, setLoaded] = useState(false);
  const authedFetch = useAuthedFetch();

  useEffect(() => {
    if (!params?.id || inMemory) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    authedFetch(`/api/proposals/${params.id}`)
      .then(async (r) => (r.ok ? ((await r.json()) as { proposal: ProposalUI }) : null))
      .then((j) => {
        if (!cancelled && j?.proposal) setColdRead(j.proposal);
        if (!cancelled) setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [params?.id, inMemory]);

  const proposal = inMemory ?? coldRead ?? null;

  function handleClose(decision: 'placed' | 'skipped' | null) {
    if (params?.id && inMemory) removeProposal(params.id);
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
        Loading proposal…
      </div>
    );
  }

  return (
    <ProposalModal proposal={proposal} fallbackId={params?.id} onClose={handleClose} />
  );
}
