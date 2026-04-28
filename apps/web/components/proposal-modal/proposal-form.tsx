'use client';

interface ProposalFormProps {
  size: number;
  trigger: number;
  tp: number;
  sl: number;
  onSize: (v: number) => void;
  onTrigger: (v: number) => void;
  onTp: (v: number) => void;
  onSl: (v: number) => void;
}

/**
 * Editable trade-parameters block: size / trigger / TP / SL with inline
 * percentage hints and an R/R footer line. Pure controlled inputs.
 */
export function ProposalForm({ size, trigger, tp, sl, onSize, onTrigger, onTp, onSl }: ProposalFormProps) {
  const sizeWarning =
    size > 500 ? `Above your $500 max trade size — proceed with caution.` : null;
  const tpPctRaw = trigger > 0 ? ((tp - trigger) / trigger) * 100 : 0;
  const slPctRaw = trigger > 0 ? ((sl - trigger) / trigger) * 100 : 0;
  const tpPct = Number.isFinite(tpPctRaw) ? tpPctRaw : 0;
  const slPct = Number.isFinite(slPctRaw) ? slPctRaw : 0;
  const rr = sl > 0 && trigger > sl && tp > trigger ? (tp - trigger) / (trigger - sl) : null;

  return (
    <>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 12,
          marginBottom: 12,
        }}
      >
        <NumField label="Size (USDC)" value={size} onChange={onSize} warning={sizeWarning} step={10} />
        <NumField label="Trigger price" value={trigger} onChange={onTrigger} step={0.5} />
        <NumField
          label={`Take profit ${tp > trigger ? `(+${tpPct.toFixed(1)}%)` : ''}`}
          value={tp}
          onChange={onTp}
          step={0.5}
          color="var(--color-buy)"
        />
        <NumField
          label={`Stop loss ${sl > 0 && trigger > sl ? `(${slPct.toFixed(1)}%)` : ''}`}
          value={sl}
          onChange={onSl}
          step={0.5}
          color="var(--color-sell)"
        />
      </div>
      {rr != null && (
        <div style={{ fontSize: 12, color: 'var(--color-fg-muted)', marginBottom: 18 }}>
          Risk / reward ratio: <strong>{rr.toFixed(2)}x</strong> (reward / risk)
        </div>
      )}
    </>
  );
}

function NumField({
  label,
  value,
  onChange,
  warning,
  step,
  color,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  warning?: string | null;
  step?: number;
  color?: string;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12, color: color ?? 'var(--color-fg-muted)' }}>{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        step={step ?? 1}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          padding: 10,
          borderRadius: 8,
          background: 'var(--color-bg-muted)',
          color: 'var(--color-fg)',
          border: `1px solid ${warning ? 'var(--color-warn)' : 'var(--color-border)'}`,
        }}
      />
      {warning && <span style={{ fontSize: 11, color: 'var(--color-warn)' }}>{warning}</span>}
    </label>
  );
}
