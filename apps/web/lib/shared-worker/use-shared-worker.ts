'use client';

import { BroadcastChannel } from 'broadcast-channel';
import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  WsClientEvents,
  WsServerEvents,
  type ApprovalDecisionPayload,
  type Proposal,
  type Signal,
  type TriggerHitPayload,
} from '@hunch-it/shared';
import { useWallet } from '@/lib/wallet/use-wallet';

export const BROADCAST_CHANNEL = 'hunch-it';

type WorkerToTab =
  | { type: 'connected' }
  | { type: 'disconnected'; reason: string }
  | { type: 'signal:new'; signal: Signal }
  | { type: 'proposal:new'; proposal: Proposal };

type TabToWorker =
  | { type: 'hello' }
  | { type: 'approval'; payload: ApprovalDecisionPayload };

interface UseSharedWorkerOptions {
  onSignal?: (signal: Signal) => void;
  onProposal?: (proposal: Proposal) => void;
  onTriggerHit?: (payload: TriggerHitPayload) => void;
}

interface UseSharedWorkerReturn {
  connected: boolean;
  sendApproval: (payload: ApprovalDecisionPayload) => void;
}

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'http://localhost:4000';

export function useSharedWorker(opts: UseSharedWorkerOptions = {}): UseSharedWorkerReturn {
  const [connected, setConnected] = useState(false);
  const portRef = useRef<MessagePort | null>(null);
  const directSocketRef = useRef<Socket | null>(null);
  const onSignalRef = useRef<((s: Signal) => void) | undefined>(opts.onSignal);
  const onProposalRef = useRef<((p: Proposal) => void) | undefined>(opts.onProposal);
  const onTriggerHitRef = useRef<((p: TriggerHitPayload) => void) | undefined>(
    opts.onTriggerHit,
  );
  onSignalRef.current = opts.onSignal;
  onProposalRef.current = opts.onProposal;
  onTriggerHitRef.current = opts.onTriggerHit;

  // Send a Privy access token; the server verifies it and resolves the
  // wallet from our DB.
  const { ready, connected: walletConnected, getAccessToken } = useWallet();

  useEffect(() => {
    if (typeof window === 'undefined') return;

    function handleMessage(msg: WorkerToTab) {
      if (!msg) return;
      if (msg.type === 'connected') setConnected(true);
      else if (msg.type === 'disconnected') setConnected(false);
      else if (msg.type === 'signal:new') onSignalRef.current?.(msg.signal);
      else if (msg.type === 'proposal:new') onProposalRef.current?.(msg.proposal);
    }

    const channel = new BroadcastChannel<WorkerToTab>(BROADCAST_CHANNEL);
    channel.addEventListener('message', handleMessage);

    console.info(`[ws] opening direct Socket.IO to ${WS_URL}`);
    const socket = io(WS_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 10_000,
    });
    directSocketRef.current = socket;
    socket.on('connect', async () => {
      console.info('[ws] direct socket connected', socket.id);
      setConnected(true);
      if (!ready || !walletConnected) return;
      const token = await getAccessToken();
      if (!token) {
        console.warn('[ws] no Privy access token; staying unauthenticated');
        return;
      }
      socket.emit(WsClientEvents.Auth, { privyAccessToken: token });
    });
    socket.on('disconnect', (reason) => {
      console.info('[ws] direct socket disconnected', reason);
      setConnected(false);
    });
    socket.on(WsServerEvents.SignalNew, (signal: Signal) => {
      onSignalRef.current?.(signal);
    });
    socket.on(WsServerEvents.ProposalNew, (proposal: Proposal) => {
      onProposalRef.current?.(proposal);
    });
    socket.on(WsServerEvents.TriggerHit, (payload: TriggerHitPayload) => {
      onTriggerHitRef.current?.(payload);
    });

    return () => {
      channel.removeEventListener('message', handleMessage);
      void channel.close();
      if (directSocketRef.current) {
        directSocketRef.current.disconnect();
        directSocketRef.current = null;
      }
      portRef.current = null;
    };
  }, [ready, walletConnected]);

  function sendApproval(payload: ApprovalDecisionPayload) {
    const port = portRef.current;
    if (port) {
      port.postMessage({ type: 'approval', payload } satisfies TabToWorker);
      return;
    }
    if (directSocketRef.current) {
      directSocketRef.current.emit(WsClientEvents.ApprovalDecision, payload);
      return;
    }
    void fetch('/api/approvals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {});
  }

  return { connected, sendApproval };
}
