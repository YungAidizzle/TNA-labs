"use client";

import { useEffect, useRef } from "react";

export type TradingViewChartPreviewStatus =
  | { state: "mounting" }
  | { state: "mounted" }
  | { state: "failed"; failureCode: "widget_script_error" | "widget_iframe_timeout" };

type TradingViewChartPreviewProps = {
  symbol: string;
  onStatusChange?: (status: TradingViewChartPreviewStatus) => void;
};

export function TradingViewChartPreview({ symbol, onStatusChange }: TradingViewChartPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onStatusChangeRef = useRef<typeof onStatusChange>(onStatusChange);

  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    let settled = false;
    let disposed = false;
    let pollId = 0;
    let timeoutId = 0;
    const applyIframeLayout = (iframe: HTMLIFrameElement) => {
      const wrapper = iframe.parentElement as HTMLElement | null;
      if (wrapper) {
        wrapper.style.position = "absolute";
        wrapper.style.inset = "0";
        wrapper.style.width = "100%";
        wrapper.style.height = "100%";
      }

      iframe.style.display = "block";
      iframe.style.width = "100%";
      iframe.style.height = "100%";

      if (widgetRoot.isConnected) {
        widgetRoot.style.display = "none";
      }
    };
    const notify = (status: TradingViewChartPreviewStatus) => {
      if (disposed) {
        return;
      }

      onStatusChangeRef.current?.(status);
    };
    const settle = (status: TradingViewChartPreviewStatus) => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearInterval(pollId);
      window.clearTimeout(timeoutId);
      notify(status);
    };

    container.innerHTML = "";
    notify({ state: "mounting" });

    const widgetRoot = document.createElement("div");
    widgetRoot.className = "tradingview-widget-container__widget pointer-events-none absolute inset-0";
    container.appendChild(widgetRoot);

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval: "15",
      timezone: "Etc/UTC",
      theme: "dark",
      style: "1",
      locale: "en",
      enable_publishing: false,
      allow_symbol_change: false,
      hide_top_toolbar: true,
      hide_side_toolbar: true,
      hide_legend: true,
      withdateranges: false,
      calendar: false,
      gridColor: "rgba(255,255,255,0.06)",
      backgroundColor: "#090e15",
      studies: [],
      support_host: "https://www.tradingview.com",
    });
    script.onerror = () => {
      settle({ state: "failed", failureCode: "widget_script_error" });
    };
    container.appendChild(script);

    pollId = window.setInterval(() => {
      if (settled) {
        return;
      }

      const iframe = container.querySelector("iframe");
      if (!iframe) {
        return;
      }

      applyIframeLayout(iframe);
      settle({ state: "mounted" });
    }, 250);
    timeoutId = window.setTimeout(() => {
      settle({ state: "failed", failureCode: "widget_iframe_timeout" });
    }, 9_000);

    return () => {
      disposed = true;
      window.clearInterval(pollId);
      window.clearTimeout(timeoutId);
      container.innerHTML = "";
    };
  }, [symbol]);

  return (
    <div
      ref={containerRef}
      className="tradingview-widget-container relative h-full w-full min-h-[320px] overflow-hidden"
      data-testid="tradingview-chart-preview"
    />
  );
}
