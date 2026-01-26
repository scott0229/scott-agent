'use client';

import { useEffect, useRef, memo } from 'react';

interface TradingViewWidgetProps {
    symbol?: string;
    theme?: 'light' | 'dark';
    studies?: string[];
}

export default memo(function TradingViewWidget(props: TradingViewWidgetProps) {
    const container = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!container.current) return;

        // Check if script is already added to avoid duplicates
        if (container.current.querySelector('script')) return;

        const script = document.createElement("script");
        script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
        script.type = "text/javascript";
        script.async = true;
        script.innerHTML = JSON.stringify({
            "autosize": true,
            "symbol": props.symbol || "NASDAQ:QQQ",
            "interval": "D",
            "timezone": "Etc/UTC",
            "theme": props.theme || "dark",
            "style": "1",
            "locale": "en",
            "enable_publishing": false,
            "allow_symbol_change": true,
            "studies": props.studies || [],
            "support_host": "https://www.tradingview.com"
        });
        container.current.appendChild(script);
    }, [props.symbol, props.theme, props.studies]);

    return (
        <div className="tradingview-widget-container" ref={container} style={{ height: "100%", width: "100%" }}>
            <div className="tradingview-widget-container__widget" style={{ height: "calc(100% - 32px)", width: "100%" }}></div>
            <div className="tradingview-widget-copyright">
                <a href="https://www.tradingview.com/" rel="noopener nofollow" target="_blank">
                    <span className="blue-text">Track all markets on TradingView</span>
                </a>
            </div>
        </div>
    );
});
