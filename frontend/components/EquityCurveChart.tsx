'use client';

import { useEffect, useRef } from 'react';
import { createChart, ColorType, LineStyle, type IChartApi, type UTCTimestamp } from 'lightweight-charts';
import { ExecEquityPoint } from '../lib/types';

export default function EquityCurveChart({ points, hwm }: { points: ExecEquityPoint[]; hwm: number | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    chartRef.current?.remove();
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 280,
      layout: { background: { type: ColorType.Solid, color: '#0a0a0a' }, textColor: '#a3a3a3' },
      grid: { vertLines: { color: '#1f1f1f' }, horzLines: { color: '#1f1f1f' } },
      timeScale: { timeVisible: true, secondsVisible: false },
    });
    const area = chart.addAreaSeries({
      lineColor: '#f59e0b',
      topColor: 'rgba(245,158,11,0.30)',
      bottomColor: 'rgba(245,158,11,0.02)',
      lineWidth: 2,
    });

    // strictly-ascending, unique timestamps (lightweight-charts requirement)
    const byTime = new Map<number, number>();
    for (const p of points) {
      const t = Math.floor(Date.parse(p.ts) / 1000);
      if (Number.isFinite(t)) byTime.set(t, Number(p.equity));
    }
    const data = [...byTime.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([time, value]) => ({ time: time as UTCTimestamp, value }));
    area.setData(data);

    if (hwm != null && data.length) {
      area.createPriceLine({ price: hwm, color: '#22c55e', lineStyle: LineStyle.Dashed, lineWidth: 1, title: 'HWM', axisLabelVisible: true });
    }
    chart.timeScale().fitContent();
    chartRef.current = chart;

    const onResize = () => {
      if (containerRef.current && chartRef.current) chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chartRef.current?.remove();
    };
  }, [points, hwm]);

  return <div ref={containerRef} className="w-full" />;
}
