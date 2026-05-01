import type { CSSProperties } from 'react';

export const card: CSSProperties = {
  background: 'var(--color-bg-elevated, #0e1118)',
  border: '1px solid var(--color-border, #1f2330)',
  borderRadius: 12,
  padding: 16,
  marginBottom: 16,
};

export const sectionHeader: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  marginBottom: 12,
  paddingBottom: 8,
  borderBottom: '1px solid var(--color-border, #1f2330)',
};

export const sectionTitle: CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  letterSpacing: 0.5,
  textTransform: 'uppercase',
  color: 'var(--color-fg, #e6e6e6)',
};

export const sectionSub: CSSProperties = {
  fontSize: 12,
  color: 'var(--color-fg-muted, #888)',
};

export const input: CSSProperties = {
  padding: '8px 10px',
  borderRadius: 6,
  background: 'var(--color-bg-muted, #1a1f2e)',
  color: 'var(--color-fg, #e6e6e6)',
  border: '1px solid var(--color-border, #2a3142)',
  fontSize: 13,
  width: '100%',
  boxSizing: 'border-box',
};

export const button: CSSProperties = {
  padding: '8px 14px',
  borderRadius: 6,
  background: 'var(--color-accent, #4f46e5)',
  color: '#fff',
  border: 'none',
  fontSize: 13,
  cursor: 'pointer',
};

export const buttonDanger: CSSProperties = {
  ...button,
  background: 'var(--color-sell, #ef4444)',
};

export const buttonGhost: CSSProperties = {
  ...button,
  background: 'transparent',
  border: '1px solid var(--color-border, #2a3142)',
  color: 'var(--color-fg-muted, #888)',
};

export const errorText: CSSProperties = {
  color: 'var(--color-sell, #ef4444)',
  fontSize: 12,
  marginTop: 6,
};

export const okText: CSSProperties = {
  color: 'var(--color-buy, #22c55e)',
  fontSize: 12,
  marginTop: 6,
};

export const muted: CSSProperties = {
  color: 'var(--color-fg-muted, #888)',
  fontSize: 12,
};

export const code: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  fontSize: 12,
  background: 'var(--color-bg-muted, #1a1f2e)',
  padding: '1px 6px',
  borderRadius: 4,
};

export const pre: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  fontSize: 11,
  background: 'var(--color-bg-muted, #1a1f2e)',
  padding: 10,
  borderRadius: 6,
  overflowX: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  color: 'var(--color-fg-muted, #aaa)',
  margin: 0,
};

export const labelRow: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  marginBottom: 8,
};

export const labelText: CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: 'var(--color-fg-muted, #888)',
};

export const grid2: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 12,
};

export const grid3: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr 1fr',
  gap: 12,
};

export const flexRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

export const badge = (color: string): CSSProperties => ({
  fontSize: 10,
  fontWeight: 600,
  padding: '2px 6px',
  borderRadius: 4,
  background: color,
  color: '#fff',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
});
