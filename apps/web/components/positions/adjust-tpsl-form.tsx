'use client';

interface AdjustTpSlFormProps {
  tpDraft: string;
  slDraft: string;
  busy: boolean;
  onTpChange: (v: string) => void;
  onSlChange: (v: string) => void;
  onSubmit: () => void;
}

/**
 * Adjust TP / SL form for ACTIVE positions. Two number inputs + an Update
 * button. The page handles the actual cancel + re-place flow.
 */
export function AdjustTpSlForm({
  tpDraft,
  slDraft,
  busy,
  onTpChange,
  onSlChange,
  onSubmit,
}: AdjustTpSlFormProps) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>Adjust TP / SL</h2>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr auto',
          gap: 12,
          alignItems: 'end',
        }}
      >
        <NumField label="Take profit" value={tpDraft} onChange={onTpChange} color="var(--color-buy)" />
        <NumField label="Stop loss" value={slDraft} onChange={onSlChange} color="var(--color-sell)" />
        <button className="btn btn-primary" disabled={busy} onClick={onSubmit}>
          Update
        </button>
      </div>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  color,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  color?: string;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12, color: color ?? 'var(--color-fg-muted)' }}>{label}</span>
      <input
        type="number"
        value={value}
        step={0.5}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: 10,
          borderRadius: 8,
          background: 'var(--color-bg-muted)',
          color: 'var(--color-fg)',
          border: '1px solid var(--color-border)',
        }}
      />
    </label>
  );
}
