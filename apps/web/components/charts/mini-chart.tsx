'use client';

import { useEffect, useRef } from 'react';
import {
  ColorType,
  createChart,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';

export interface ChartBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface ChartMarker {
  price: number;
  label?: string;
  color?: string;
}

interface MiniChartProps {
  bars: ChartBar[];
  height?: number;
  marker?: ChartMarker;
  /** Extra horizontal price lines (e.g. TP / SL). Drawn above `marker`. */
  extraMarkers?: ChartMarker[];
  color?: string;
}

/**
 * Mounts lightweight-charts in a single useEffect that depends on `bars` and
 * the marker, recreating the chart whenever the inputs change. This avoids
 * the StrictMode double-mount race where data was set on a series that the
 * cleanup had already nulled.
 */
export function MiniChart({
  bars,
  height = 140,
  marker,
  extraMarkers,
  color = '#a089ff',
}: MiniChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || bars.length === 0) return;

    let chart: IChartApi | null = null;
    let series: ISeriesApi<'Area'> | null = null;
    let ro: ResizeObserver | null = null;
    let raf = 0;

    function init() {
      if (!el) return;
      const w = el.clientWidth || el.getBoundingClientRect().width || 600;
      chart = createChart(el, {
        width: w,
        height,
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor: '#9099ad',
          fontSize: 11,
        },
        grid: {
          horzLines: { color: 'rgba(38, 43, 58, 0.6)' },
          vertLines: { visible: false },
        },
        timeScale: {
          borderColor: 'rgba(38, 43, 58, 0.6)',
          timeVisible: true,
          secondsVisible: false,
        },
        rightPriceScale: {
          borderColor: 'rgba(38, 43, 58, 0.6)',
          scaleMargins: { top: 0.15, bottom: 0.1 },
        },
        handleScroll: false,
        handleScale: false,
        crosshair: { mode: 1 },
      });

      series = chart.addAreaSeries({
        lineColor: color,
        topColor: 'rgba(160, 137, 255, 0.45)',
        bottomColor: 'rgba(160, 137, 255, 0.02)',
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
      });

      const data = bars
        .map((b) => ({ time: b.time as UTCTimestamp, value: Number(b.close) }))
        .filter((d) => Number.isFinite(d.value))
        .sort((a, b) => (a.time as number) - (b.time as number));

      series.setData(data);
      chart.timeScale().fitContent();

      if (marker) {
        series.createPriceLine({
          price: marker.price,
          color: marker.color ?? '#9099ad',
          lineStyle: LineStyle.Dashed,
          lineWidth: 1,
          axisLabelVisible: true,
          title: marker.label ?? 'mark',
        });
      }
      for (const m of extraMarkers ?? []) {
        if (!Number.isFinite(m.price)) continue;
        series.createPriceLine({
          price: m.price,
          color: m.color ?? '#9099ad',
          lineStyle: LineStyle.Dotted,
          lineWidth: 1,
          axisLabelVisible: true,
          title: m.label ?? '',
        });
      }

      ro = new ResizeObserver(() => {
        if (!el || !chart) return;
        chart.applyOptions({
          width: el.clientWidth || 600,
          height,
        });
      });
      ro.observe(el);
    }

    // Defer initialization one frame so the modal's spring transition has
    // committed layout — measuring `clientWidth` before that returns 0.
    raf = requestAnimationFrame(init);

    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      try {
        chart?.remove();
      } catch {
        /* chart already torn down */
      }
      chart = null;
      series = null;
    };
    // Recreate on bars / dimension / marker change. Cheap; <300 datapoints.
    // extraMarkers identity matters too — caller should memo if churn is a problem.
  }, [
    bars,
    height,
    color,
    marker?.price,
    marker?.label,
    marker?.color,
    extraMarkers,
  ]);

  return <div ref={containerRef} style={{ width: '100%', height }} />;
}
