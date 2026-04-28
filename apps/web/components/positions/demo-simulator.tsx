'use client';

interface DemoSimulatorProps {
  onSimTp: () => void;
  onSimSl: () => void;
}

/**
 * Demo-only OCO simulator card. Lets us verify the cancel-sibling banner UX
 * end-to-end without waiting for the real Order Tracker / Jupiter fill.
 */
export function DemoSimulator({ onSimTp, onSimSl }: DemoSimulatorProps) {
  return (
    <div
      className="card"
      style={{
        background: 'rgba(245,158,11,0.06)',
        border: '1px dashed rgba(245,158,11,0.35)',
        marginBottom: 16,
      }}
    >
      <div style={{ fontSize: 11, color: 'var(--color-warn)', marginBottom: 8 }}>
        DEMO ONLY · SIMULATE OCO FILL
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <button className="btn btn-buy" style={{ flex: 1 }} onClick={onSimTp}>
          Simulate TP fill
        </button>
        <button className="btn btn-sell" style={{ flex: 1 }} onClick={onSimSl}>
          Simulate SL fill
        </button>
      </div>
    </div>
  );
}
