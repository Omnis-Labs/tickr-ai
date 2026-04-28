'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useWallet } from '@/lib/wallet/use-wallet';

function shorten(addr: string): string {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

export function WalletButton() {
  const { connected, ready, address, login, logout } = useWallet();
  const [open, setOpen] = useState(false);

  if (!ready) {
    return (
      <Button variant="ghost" disabled>
        Loading…
      </Button>
    );
  }

  if (!connected || !address) {
    return <Button onClick={login}>Connect</Button>;
  }

  return (
    <div className="relative">
      <Button variant="ghost" className="font-mono" onClick={() => setOpen((v) => !v)}>
        {shorten(address)} ▾
      </Button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-50 min-w-[200px] rounded-lg border border-outline-variant bg-surface p-1.5 shadow-card">
          <div className="break-all px-2.5 py-2 text-[11px] text-on-surface-variant">
            {address}
          </div>
          <Button
            variant="ghost"
            className="w-full justify-start"
            onClick={() => {
              setOpen(false);
              void navigator.clipboard.writeText(address);
            }}
          >
            Copy address
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start"
            onClick={() => {
              setOpen(false);
              void logout();
            }}
          >
            Disconnect
          </Button>
        </div>
      )}
    </div>
  );
}
