'use client';

import { useEffect, useRef } from 'react';
import { useTheme } from './ThemeProvider';

/**
 * Official TradingView "Advanced Real-Time Chart" embed (free widget), loaded
 * client-side. The widget's own controls handle timeframe/indicators/drawing.
 * Recreated on theme change; fully torn down on unmount/navigation (script + the
 * iframe it injects are removed) so no widget leaks and no dispose-style crash.
 * Attribution link is kept visible per TradingView's terms.
 */
export default function TradingViewChart({
  symbol = 'OANDA:XAUUSD',
  height = 480,
}: {
  symbol?: string;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const widget = document.createElement('div');
    widget.className = 'tradingview-widget-container__widget';
    widget.style.height = 'calc(100% - 32px)';
    widget.style.width = '100%';

    const copyright = document.createElement('div');
    copyright.className = 'tradingview-widget-copyright';
    copyright.style.fontSize = '11px';
    copyright.style.lineHeight = '32px';
    copyright.style.textAlign = 'center';
    copyright.innerHTML =
      '<a href="https://www.tradingview.com/" rel="noopener nofollow" target="_blank" style="color:#2962FF;text-decoration:none">Track all markets on TradingView</a>';

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.type = 'text/javascript';
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval: '60',
      timezone: 'Etc/UTC',
      theme, // 'dark' | 'light' — matches the dashboard
      style: '1',
      locale: 'en',
      allow_symbol_change: true,
      hide_side_toolbar: false,
      support_host: 'https://www.tradingview.com',
    });

    container.appendChild(widget);
    container.appendChild(copyright);
    container.appendChild(script);

    return () => {
      // Remove the script + the iframe/DOM the widget injected (no leaks).
      try {
        while (container.firstChild) container.removeChild(container.firstChild);
      } catch {
        /* already gone */
      }
    };
  }, [symbol, theme]);

  return <div ref={containerRef} className="tradingview-widget-container" style={{ height, width: '100%' }} />;
}
