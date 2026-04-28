'use client';

import { BroadcastChannel } from 'broadcast-channel';
import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  DEMO_MANDATE,
  WsClientEvents,
  WsServerEvents,
  type ApprovalDecisionPayload,
  type DemoProposalShape,
  type Signal,
} from '@hunch-it/shared';
import { isDemo } from '@/lib/demo/flag';

export const BROADCAST_CHANNEL = 'hunch-it';

type WorkerToTab =
  | { type: 'connected' }
  | { type: 'disconnected'; reason: string }
  | { type: 'signal:new'; signal: Signal }
  | { type: 'proposal:new'; proposal: DemoProposalShape };

type TabToWorker =
  | { type: 'hello' }
  | { type: 'approval'; payload: ApprovalDecisionPayload };

export interface PositionUpdatedPayload {
  positionId: string;
  state: 'BUY_PENDING' | 'ENTERING' | 'ACTIVE' | 'CLOSING' | 'CLOSED';
  /**
   * - "cancel-sibling": TP/SL filled, OCO sibling still parked in vault and
   *   needs the user to sign a withdrawal.
   * - "sibling-cancelled": delegated server signer already cancelled the
   *   sibling — frontend just shows confirmation + refresh.
   */
  action?: 'cancel-sibling' | 'sibling-cancelled';
  siblingOrderId?: string;
  siblingKind?: 'TAKE_PROFIT' | 'STOP_LOSS';
}

interface UseSharedWorkerOptions {
  onSignal?: (signal: Signal) => void;
  onProposal?: (proposal: DemoProposalShape) => void;
  onPositionUpdated?: (payload: PositionUpdatedPayload) => void;
  /**
   * Wallet to bind this socket to. The hook emits an `auth` event with this
   * walletAddress on connect so the ws-server can route per-user proposals.
   * In demo mode, defaults to the demo wallet.
   */
  walletAddress?: string;
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
  const onProposalRef = useRef<((p: DemoProposalShape) => void) | undefined>(opts.onProposal);
  const onPositionUpdatedRef = useRef<((p: PositionUpdatedPayload) => void) | undefined>(
    opts.onPositionUpdated,
  );
  onSignalRef.current = opts.onSignal;
  onProposalRef.current = opts.onProposal;
  onPositionUpdatedRef.current = opts.onPositionUpdated;

  // The wallet address we'll auth as. Demo defaults to the demo userId so
  // demo-mode proposals (emitted to `user:demo-user`) reach the tab.
  const wallet = opts.walletAddress ?? (isDemo() ? DEMO_MANDATE.userId : undefined);

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
    socket.on('connect', () => {
      console.info('[ws] direct socket connected', socket.id);
      setConnected(true);
      if (wallet) {
        socket.emit(WsClientEvents.Auth, { walletAddress: wallet });
      }
    });
    socket.on('disconnect', (reason) => {
      console.info('[ws] direct socket disconnected', reason);
      setConnected(false);
    });
    socket.on(WsServerEvents.SignalNew, (signal: Signal) => {
      onSignalRef.current?.(signal);
    });
    socket.on(WsServerEvents.ProposalNew, (proposal: DemoProposalShape) => {
      onProposalRef.current?.(proposal);
    });
    socket.on(WsServerEvents.PositionUpdated, (payload: PositionUpdatedPayload) => {
      onPositionUpdatedRef.current?.(payload);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet]);

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
