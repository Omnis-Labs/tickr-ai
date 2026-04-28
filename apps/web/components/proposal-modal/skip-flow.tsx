'use client';

import { SKIP_REASON_LABELS, type SkipReason } from '@hunch-it/shared';

interface SkipFlowProps {
  reason: SkipReason;
  detail: string;
  onReason: (r: SkipReason) => void;
  onDetail: (s: string) => void;
  onBack: () => void;
  onSubmit: () => void;
}

/**
 * Skip-with-reason picker. Shown in place of the primary action row when
 * the user opens the skip flow. Reasons come from the shared SKIP_REASON
 * enum so the server-side Skip table uses the same vocabulary.
 */
export function SkipFlow({ reason, detail, onReason, onDetail, onBack, onSubmit }: SkipFlowProps) {
  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 10, padding: 14 }}>
      <div style={{ fontWeight: 600, marginBottom: 10 }}>Why are you skipping?</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
        {(Object.keys(SKIP_REASON_LABELS) as SkipReason[]).map((r) => (
          <button
            key={r}
            onClick={() => onReason(r)}
            style={{
              textAlign: 'left',
              padding: '8px 10px',
              borderRadius: 8,
              background: reason === r ? 'rgba(124,92,255,0.18)' : 'var(--color-bg-muted)',
              border: `1px solid ${reason === r ? 'var(--color-accent)' : 'var(--color-border)'}`,
              color: 'var(--color-fg)',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {SKIP_REASON_LABELS[r]}
          </button>
        ))}
      </div>
      {reason === 'OTHER' && (
        <input
          type="text"
          placeholder="Tell us why…"
          value={detail}
          onChange={(e) => onDetail(e.target.value)}
          style={{
            width: '100%',
            marginTop: 10,
            padding: 10,
            borderRadius: 8,
            background: 'var(--color-bg-muted)',
            color: 'var(--color-fg)',
            border: '1px solid var(--color-border)',
          }}
        />
      )}
      <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
        <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onBack}>
          Back
        </button>
        <button className="btn btn-primary" style={{ flex: 1 }} onClick={onSubmit}>
          Submit skip
        </button>
      </div>
    </div>
  );
}
