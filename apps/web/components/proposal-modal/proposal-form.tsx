'use client';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

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
      <div className="mb-3 grid grid-cols-2 gap-3">
        <NumField label="Size (USDC)" value={size} onChange={onSize} warning={sizeWarning} step={10} />
        <NumField label="Trigger price" value={trigger} onChange={onTrigger} step={0.5} />
        <NumField
          label={`Take profit ${tp > trigger ? `(+${tpPct.toFixed(1)}%)` : ''}`}
          value={tp}
          onChange={onTp}
          step={0.5}
          tone="positive"
        />
        <NumField
          label={`Stop loss ${sl > 0 && trigger > sl ? `(${slPct.toFixed(1)}%)` : ''}`}
          value={sl}
          onChange={onSl}
          step={0.5}
          tone="negative"
        />
      </div>
      {rr != null && (
        <div className="mb-4 text-xs text-on-surface-variant">
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
  tone,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  warning?: string | null;
  step?: number;
  tone?: 'positive' | 'negative';
}) {
  return (
    <label className="flex flex-col gap-1">
      <span
        className={cn(
          'text-xs',
          tone === 'positive' && 'text-positive',
          tone === 'negative' && 'text-negative',
          !tone && 'text-on-surface-variant',
        )}
      >
        {label}
      </span>
      <Input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        step={step ?? 1}
        onChange={(e) => onChange(Number(e.target.value))}
        className={warning ? 'border-tertiary' : undefined}
      />
      {warning && <span className="text-[11px] text-tertiary">{warning}</span>}
    </label>
  );
}
