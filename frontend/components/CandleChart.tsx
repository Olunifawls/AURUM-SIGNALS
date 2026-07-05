'use client';

import { useEffect, useRef } from 'react';
import {
  createChart,
  ColorType,
  LineStyle,
  type IChartApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { supabase } from '../lib/supabase';
import { emaSeries } from '../lib/ema';
import { num } from '../lib/format';
import { Candle, IndicatorSnapshot, SignalRow, Timeframe } from '../lib/types';

const toTime = (ts: string) => Math.floor(Date.parse(ts) / 1000) as UTCTimestamp;

export default function CandleChart({
  timeframe,
  indicators,
  signals,
}: {
  timeframe: Timeframe;
  indicators: Record<string, IndicatorSnapshot | null> | undefined;
  signals: SignalRow[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    let disposed = false;

    async function run() {
      if (!containerRef.current || !supabase) return;
      const { data } = await supabase
        .from('candles')
        .select('ts,open,high,low,close')
        .eq('symbol', 'XAU/USD')
        .eq('timeframe', timeframe)
        .order('ts', { ascending: false })
        .limit(300);
      if (disposed || !containerRef.current) return;

      const candles: Candle[] = (data ?? [])
        .map((r) => ({
          ts: r.ts as string,
          open: Number(r.open),
          high: Number(r.high),
          low: Number(r.low),
          close: Number(r.close),
        }))
        .reverse();

      chartRef.current?.remove();
      const chart = createChart(containerRef.current, {
        width: containerRef.current.clientWidth,
        height: 360,
        layout: { background: { type: ColorType.Solid, color: '#0a0a0a' }, textColor: '#a3a3a3' },
        grid: { vertLines: { color: '#1f1f1f' }, horzLines: { color: '#1f1f1f' } },
        rightPriceScale: { borderColor: '#262626' },
        timeScale: { borderColor: '#262626', timeVisible: true },
      });
      chartRef.current = chart;

      const candleSeries = chart.addCandlestickSeries({
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderVisible: false,
        wickUpColor: '#22c55e',
        wickDownColor: '#ef4444',
      });
      candleSeries.setData(
        candles.map((c) => ({ time: toTime(c.ts), open: c.open, high: c.high, low: c.low, close: c.close })),
      );

      const closes = candles.map((c) => c.close);
      const addEma = (period: number, color: string) => {
        const series = chart.addLineSeries({
          color,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        const e = emaSeries(closes, period);
        series.setData(
          candles
            .map((c, i) => (e[i] != null ? { time: toTime(c.ts), value: e[i] as number } : null))
            .filter((x): x is { time: UTCTimestamp; value: number } => x != null),
        );
      };
      addEma(20, '#3b82f6');
      addEma(50, '#a855f7');
      addEma(200, '#f59e0b');

      const ind = indicators?.[timeframe];
      const support = num(ind?.nearest_support ?? null);
      const resistance = num(ind?.nearest_resistance ?? null);
      if (support != null)
        candleSeries.createPriceLine({
          price: support,
          color: '#22c55e',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: 'S',
        });
      if (resistance != null)
        candleSeries.createPriceLine({
          price: resistance,
          color: '#ef4444',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: 'R',
        });

      const markers = signals
        .filter((s) => s.timeframe === timeframe)
        .map((s) => ({
          time: toTime(s.created_at),
          position: (s.direction === 'BUY' ? 'belowBar' : 'aboveBar') as 'belowBar' | 'aboveBar',
          color: s.direction === 'BUY' ? '#22c55e' : '#ef4444',
          shape: (s.direction === 'BUY' ? 'arrowUp' : 'arrowDown') as 'arrowUp' | 'arrowDown',
          text: `${s.direction} ${s.confluence_score}/${s.confluence_max}`,
        }));
      if (markers.length) candleSeries.setMarkers(markers);

      chart.timeScale().fitContent();
    }

    void run();
    const onResize = () => {
      if (containerRef.current && chartRef.current)
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
    };
    window.addEventListener('resize', onResize);
    return () => {
      disposed = true;
      window.removeEventListener('resize', onResize);
      chartRef.current?.remove();
      chartRef.current = null;
    };
  }, [timeframe, indicators, signals]);

  return <div ref={containerRef} className="w-full" />;
}
