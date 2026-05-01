'use client';

import { useState } from 'react';
import { WalletSection } from './_sections/wallet';
import { TriggerBuySection } from './_sections/trigger-buy';
import { UltraSwapSection } from './_sections/ultra-swap';
import { SetTpSlSection } from './_sections/set-tp-sl';
import { ChangeTpSlSection } from './_sections/change-tp-sl';
import { ClosePositionSection } from './_sections/close-position';
import { SignalMonitorSection } from './_sections/signal-monitor';
import { ConnectivitySection } from './_sections/connectivity';
import { InspectorSection } from './_sections/inspector';

export default function DevToolsPage() {
  // S1 broadcasts WEN balance up so S4/S5/S6 can show/hide accurately.
  const [walletWenBalance, setWalletWenBalance] = useState<number | null>(null);
  // Bumped whenever S2/S3 succeed or S4/S5 mutate exits — forces dependent
  // sections to re-mount and refetch their derived state.
  const [bump, setBump] = useState(0);
  const onMutate = () => setBump((n) => n + 1);

  return (
    <main
      style={{
        maxWidth: 880,
        margin: '0 auto',
        padding: '24px 16px 80px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: 'var(--color-fg, #e6e6e6)',
      }}
    >
      <Banner />
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>dev-tools</h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, opacity: 0.7 }}>
          Manual debug surface. Real production hooks. Zero DB writes.
        </p>
      </header>

      <WalletSection onWenChange={setWalletWenBalance} key={`s1-${bump}`} />
      <TriggerBuySection onResolved={onMutate} />
      <UltraSwapSection onSwapped={onMutate} />
      <SetTpSlSection
        walletWenBalance={walletWenBalance}
        onPlaced={onMutate}
        key={`s4-${bump}`}
      />
      <ChangeTpSlSection
        walletWenBalance={walletWenBalance}
        onChanged={onMutate}
        key={`s5-${bump}`}
      />
      <ClosePositionSection
        walletWenBalance={walletWenBalance}
        onClosed={onMutate}
        key={`s6-${bump}`}
      />
      <SignalMonitorSection />
      <ConnectivitySection />
      <InspectorSection />
    </main>
  );
}

function Banner() {
  return (
    <div
      style={{
        background: 'linear-gradient(90deg, #ef4444, #f59e0b)',
        color: '#fff',
        padding: '8px 14px',
        borderRadius: 8,
        marginBottom: 16,
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: 1,
        textTransform: 'uppercase',
        textAlign: 'center',
      }}
    >
      DEV ONLY · Real Jupiter orders · Token: WEN · Not for production users
    </div>
  );
}
