'use client';

import type { ReactNode } from 'react';
import * as s from './styles';

interface SectionProps {
  id: string;
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
  children: ReactNode;
}

export function Section({ id, title, subtitle, trailing, children }: SectionProps) {
  return (
    <section id={id} style={s.card}>
      <header style={s.sectionHeader}>
        <div>
          <span style={s.sectionTitle}>
            {id.toUpperCase()} · {title}
          </span>
          {subtitle && <div style={{ ...s.sectionSub, marginTop: 4 }}>{subtitle}</div>}
        </div>
        {trailing}
      </header>
      {children}
    </section>
  );
}
