'use client';

import { useEffect, useRef } from 'react';
import { useTheme } from './ThemeProvider';

/**
 * Official TradingView "Advanced Real-Time Chart" embed (free widget), loaded
 * client-side. Fills its parent (the parent sets a responsive height), autosizes.
 * Pre-loads the six studies the engine uses (EMA 20/50/200 on price + RSI 14,
 * MACD 12/26/9, ATR 14 in sub-panes) as toggleable defaults. The widget's own
 * controls handle timeframe/indicators/drawing/fullscreen.
 * Recreated on theme change; fully torn down on unmount/navigation (script + the
 * iframe it injects are removed) so no widget leaks and no dispose-style crash.
 * Attribution link is kept visible per TradingView's terms.
 */
export default function TradingViewChart({ symbol = 'OANDA:XAUUSD' }: { symbol?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const widget = document.createElement('div');
    widget.className = 'tradingview-widget-container__widget';
    widget.style.height = 'calc(100% - 28px)';
    widget.style.width = '100%';

    const copyright = document.createElement('div');
    copyright.className = 'tradingview-widget-copyright';
    copyright.style.fontSize = '11px';
    copyright.style.lineHeight = '28px';
    copyright.style.textAlign = 'center';
    copyright.innerHTML =
      '<a href="https://www.tradingview.com/" rel="noopener nofollow" target="_blank" style="color:#2962FF;text-decoration:none">Track all markets on TradingView</a>';

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.type = 'text/javascript';
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true, // fills the container (parent sets the responsive height)
      symbol,
      interval: '60',
      timezone: 'Etc/UTC',
      theme, // 'dark' | 'light' — matches the dashboard
      style: '1',
      locale: 'en',
      allow_symbol_change: true,
      hide_side_toolbar: false,
      withdateranges: true,
      // Engine indicators as toggleable defaults: EMA 20/50/200 on price,
      // RSI(14) / MACD(12,26,9) / ATR(14) in their own sub-panes. NOTE: the free
      // TradingView embed pre-loads at most 5 studies, so the 6th (ATR, last) is
      // one tap away via the widget's "Indicators" control.
      studies: [
        { id: 'MAExp@tv-basicstudies', inputs: { length: 20 } },
        { id: 'MAExp@tv-basicstudies', inputs: { length: 50 } },
        { id: 'MAExp@tv-basicstudies', inputs: { length: 200 } },
        { id: 'RSI@tv-basicstudies', inputs: { length: 14 } },
        { id: 'MACD@tv-basicstudies' },
        { id: 'ATR@tv-basicstudies', inputs: { length: 14 } },
      ],
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

  return <div ref={containerRef} className="tradingview-widget-container h-full w-full" />;
}
