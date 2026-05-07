'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ProposalModal } from '@/components/proposal-modal/proposal-modal';
import { useProposalsStore, type ProposalUI } from '@/lib/store/proposals';
import { useAuthedFetch } from '@/lib/auth/fetch';
import { isProposalExpired } from '@/lib/proposals/expiration';
import { useWallet } from '@/lib/wallet/use-wallet';

export default function ProposalDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const inMemory = useProposalsStore((s) => (params?.id ? s.proposalsById[params.id] : undefined));
  const removeProposal = useProposalsStore((s) => s.removeProposal);
  const [coldRead, setColdRead] = useState<ProposalUI | null>(null);
  const [loaded, setLoaded] = useState(false);
  const authedFetch = useAuthedFetch();
  const { ready, connected } = useWallet();

  useEffect(() => {
    if (!params?.id) {
      setColdRead(null);
      setLoaded(true);
      return;
    }

    if (inMemory?.status === 'EXPIRED' || (inMemory && isProposalExpired(inMemory))) {
      removeProposal(inMemory.id);
      setColdRead(null);
      setLoaded(true);
      return;
    }

    if (inMemory) {
      setColdRead(null);
      setLoaded(true);
      return;
    }

    if (!ready) {
      setLoaded(false);
      return;
    }

    if (!connected) {
      setColdRead(null);
      setLoaded(true);
      return;
    }

    let cancelled = false;
    setColdRead(null);
    setLoaded(false);
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
  }, [params?.id, inMemory, ready, connected, authedFetch, removeProposal]);

  const displayInMemory =
    inMemory && inMemory.status !== 'EXPIRED' && !isProposalExpired(inMemory) ? inMemory : null;
  const proposal = displayInMemory ?? coldRead ?? null;

  function handleBack() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
      return;
    }
    router.push('/desk');
  }

  function handleDecision(decision: 'placed' | 'skipped' | null) {
    if (params?.id && decision && inMemory) removeProposal(params.id);
    router.replace('/desk');
  }

  if (!loaded) {
    return (
      <div className="min-h-screen grid place-items-center text-on-surface-variant text-body-md">
        <div className="flex items-center gap-3">
          <span className="inline-block w-5 h-5 border-2 border-on-surface-variant/30 border-t-on-surface-variant rounded-full animate-spin" />
          Loading proposal...
        </div>
      </div>
    );
  }

  return (
    <ProposalModal
      proposal={proposal}
      fallbackId={params?.id}
      onBack={handleBack}
      onDecision={handleDecision}
    />
  );
}
