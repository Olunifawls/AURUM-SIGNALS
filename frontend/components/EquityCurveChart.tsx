'use client';

import { useEffect, useRef } from 'react';
import {
  createChart,
  ColorType,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { ExecEquityPoint } from '../lib/types';
import { useTheme } from './ThemeProvider';

const chartColors = (theme: 'dark' | 'light') =>
  theme === 'light'
    ? { bg: '#ffffff', text: '#525252', grid: '#e5e5e5' }
    : { bg: '#0a0a0a', text: '#a3a3a3', grid: '#1f1f1f' };

/** Sanitize points for lightweight-charts: drop null/NaN, sort ascending by time,
 * de-duplicate identical timestamps (keep the latest value). */
function sanitize(points: ExecEquityPoint[] | undefined): { time: UTCTimestamp; value: number }[] {
  const byTime = new Map<number, number>();
  for (const p of points ?? []) {
    const t = Math.floor(Date.parse(p?.ts ?? '') / 1000);
    const v = Number(p?.equity);
    if (Number.isFinite(t) && Number.isFinite(v)) byTime.set(t, v); // dedupe -> latest wins
  }
  return [...byTime.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([time, value]) => ({ time: time as UTCTimestamp, value }));
}

export default function EquityCurveChart({ points, hwm }: { points: ExecEquityPoint[]; hwm: number | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null);
  const priceLineRef = useRef<IPriceLine | null>(null);
  const { theme } = useTheme();

  // Create the chart ONCE (never recreated on poll — recreating + double-remove was
  // the "Object is disposed" crash). Subsequent updates go through setData below.
  useEffect(() => {
    if (!containerRef.current) return;
    const c = chartColors(theme);
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 280,
      layout: { background: { type: ColorType.Solid, color: c.bg }, textColor: c.text },
      grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
      timeScale: { timeVisible: true, secondsVisible: false },
    });
    chartRef.current = chart;
    seriesRef.current = chart.addAreaSeries({
      lineColor: '#f59e0b',
      topColor: 'rgba(245,158,11,0.30)',
      bottomColor: 'rgba(245,158,11,0.02)',
      lineWidth: 2,
    });

    const onResize = () => {
      if (containerRef.current && chartRef.current) chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      try {
        chartRef.current?.remove();
      } catch {
        /* already disposed — ignore */
      }
      chartRef.current = null;
      seriesRef.current = null;
      priceLineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // create ONCE; theme colors are (re)applied by the effect below

  // Re-apply theme colors on toggle (no recreate).
  useEffect(() => {
    const c = chartColors(theme);
    chartRef.current?.applyOptions({
      layout: { background: { type: ColorType.Solid, color: c.bg }, textColor: c.text },
      grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
    });
  }, [theme]);

  // Update data on every poll — no recreate, so no disposed-object risk.
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    try {
      series.setData(sanitize(points));
      if (priceLineRef.current) {
        series.removePriceLine(priceLineRef.current);
        priceLineRef.current = null;
      }
      if (hwm != null && Number.isFinite(hwm)) {
        priceLineRef.current = series.createPriceLine({
          price: hwm,
          color: '#22c55e',
          lineStyle: LineStyle.Dashed,
          lineWidth: 1,
          title: 'HWM',
          axisLabelVisible: true,
        });
      }
      chart.timeScale().fitContent();
    } catch {
      /* one transient bad render must not white-screen the page */
    }
  }, [points, hwm]);

  return <div ref={containerRef} className="w-full" />;
}
