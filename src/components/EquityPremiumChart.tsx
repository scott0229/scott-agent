'use client';

import { useState } from 'react';
import {
    LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
    CartesianGrid, ReferenceLine
} from 'recharts';
import { calculatePremiumRate } from '@/lib/options-metrics';

interface DailyPremium {
    date: number;
    cumulative_profit: number;
}

interface EquityPremiumChartProps {
    equityHistory: { date: number; net_equity: number; rate: number; exposure_adjustment?: string }[];
    dailyPremium: DailyPremium[];
    initialCost: number;
    totalDailyInterest?: number;
    /**
     * Canonical annual premium (numerator of 期權收益率). When provided,
     * the chart's LAST data point uses this value directly so it agrees
     * exactly with the summary card and daily report. Intermediate
     * points still derive their value from dailyPremium + linear interest
     * since per-day cash balance isn't available client-side.
     */
    annualPremium?: number;
    name?: string;
}

export function EquityPremiumChart({ equityHistory, dailyPremium, initialCost, totalDailyInterest = 0, annualPremium, name }: EquityPremiumChartProps) {
    const [visible, setVisible] = useState({ equity: true, premium: true });
    const toggle = (key: keyof typeof visible) => setVisible(prev => ({ ...prev, [key]: !prev[key] }));

    const hasData = equityHistory && equityHistory.length > 0;

    // Sort premium entries by date and extract daily increments
    const sortedPremiumDates = dailyPremium
        ? [...dailyPremium].sort((a, b) => a.date - b.date)
        : [];

    // Flat cost base = caller-supplied initial cost.
    // If <= 0 we render 0% (rather than exploding via a /1 fallback).
    const costBase = initialCost > 0 ? initialCost : 0;

    // Build chart data with flat-denominator premium rate.
    // Interest is approximated linearly over the chart range for intermediate
    // points (no per-day cash balance to compute it precisely), but the LAST
    // point pins to the full totalDailyInterest so it matches the summary card
    // and daily report exactly — all three surfaces share the canonical value.
    const sortedHistory = (equityHistory || []).slice().sort((a, b) => a.date - b.date);
    const firstDate = sortedHistory.length > 0 ? sortedHistory[0].date : 0;
    const lastDate = sortedHistory.length > 0 ? sortedHistory[sortedHistory.length - 1].date : 0;
    const totalRange = Math.max(1, lastDate - firstDate);

    const chartData = sortedHistory.map((item, idx, arr) => {
        const d = new Date(item.date * 1000);

        // Find the latest cumulative premium on or before this date
        let cumPremium = 0;
        for (const dp of sortedPremiumDates) {
            if (dp.date <= item.date) {
                cumPremium = dp.cumulative_profit;
            } else {
                break;
            }
        }

        const isLast = idx === arr.length - 1;
        // Last point pins to the canonical annualPremium when provided, so
        // the tooltip / final dot exactly matches the summary card and the
        // daily report. Earlier points keep the linear-interest approximation.
        let cumWithInterest: number;
        if (isLast && annualPremium !== undefined) {
            cumWithInterest = annualPremium;
        } else {
            const elapsed = Math.max(0, item.date - firstDate);
            const interestShare = isLast
                ? totalDailyInterest
                : totalDailyInterest * (elapsed / totalRange);
            cumWithInterest = cumPremium + interestShare;
        }

        const premiumRate = calculatePremiumRate(cumWithInterest, costBase);

        return {
            date: item.date,
            dateStr: `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`,
            equityRate: item.rate,
            premiumRate,
            rawEquity: item.net_equity,
            rawPremium: cumWithInterest,
            exposure_adjustment: item.exposure_adjustment
        };
    });

    const formatPercent = (value: number) => `${value.toFixed(1)}%`;

    return (
        <div className="relative w-full h-full border rounded-md flex flex-col overflow-hidden">
            <div className="flex-1 w-full min-h-0 relative">
                {!hasData ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground gap-2">
                        <div className="w-12 h-12 rounded-lg border-2 border-dashed border-muted-foreground/50 flex items-center justify-center">
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="w-6 h-6"
                            >
                                <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                                <circle cx="9" cy="9" r="2" />
                                <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                            </svg>
                        </div>
                        <span className="text-xs">無歷史資料</span>
                    </div>
                ) : (
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chartData} margin={{ top: 20, right: 15, left: 10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />
                            <XAxis
                                dataKey="dateStr"
                                tick={{ fontSize: 12, fill: 'var(--foreground)' }}
                                minTickGap={30}
                                interval="preserveStartEnd"
                                padding={{ left: 10, right: 10 }}
                                axisLine={false}
                                tickLine={false}
                                dy={5}
                            />
                            {/* Single Y-Axis: percentage */}
                            <YAxis
                                tick={(props: any) => {
                                    const { x, y, payload, index } = props;
                                    if (index === 0) return null;
                                    return (
                                        <text x={x} y={y} dy={4} textAnchor="end" fill="var(--foreground)" fontSize={12}>
                                            {formatPercent(payload.value)}
                                        </text>
                                    );
                                }}
                                tickCount={6}
                                width={60}
                                domain={['auto', 'auto']}
                                axisLine={false}
                                tickLine={false}
                            />
                            {/* 0% reference line */}
                            <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeOpacity={0.3} />
                            <Tooltip
                                defaultIndex={chartData.length - 1}
                                content={({ active, payload, label }) => {
                                    if (!active || !payload || payload.length === 0) return null;
                                    const dataPoint = payload[0]?.payload;
                                    const exposureVal = dataPoint?.exposure_adjustment;
                                    const exposureLabel = exposureVal === 'buy_qqq' ? '買入QQQ' : exposureVal === 'buy_qld' ? '買入QLD' : null;

                                    return (
                                        <div style={{
                                            backgroundColor: 'var(--popover)',
                                            padding: '8px 12px',
                                            fontSize: '12px'
                                        }}>
                                            <div style={{ color: 'var(--foreground)', marginBottom: '4px', fontWeight: 500, backgroundColor: 'var(--muted)', padding: '2px 6px', borderRadius: '4px' }}>
                                                日期 : {label}
                                            </div>
                                            {exposureLabel && (
                                                <div style={{ color: 'var(--foreground)', marginBottom: '4px' }}>
                                                    調倉：{exposureLabel}
                                                </div>
                                            )}
                                            {dataPoint && visible.equity && (
                                                <div style={{ color: 'var(--chart-blue-dark)', padding: 0 }}>
                                                    淨值 : {dataPoint.equityRate.toFixed(2)}% ({Math.round(dataPoint.rawEquity).toLocaleString()})
                                                </div>
                                            )}
                                            {dataPoint && visible.premium && (
                                                <div style={{ color: 'var(--chart-orange-dark)', padding: 0 }}>
                                                    期權收益 : {dataPoint.premiumRate.toFixed(2)}% ({Math.round(dataPoint.rawPremium).toLocaleString()})
                                                </div>
                                            )}
                                        </div>
                                    );
                                }}
                                position={{ x: 65, y: 5 }}
                                contentStyle={{ border: 'none', padding: 0, background: 'transparent', boxShadow: 'none' }}
                                wrapperStyle={{ pointerEvents: 'none', zIndex: 10, outline: 'none', border: 'none', boxShadow: 'none' }}
                                itemStyle={{ border: 'none' }}
                                cursor={{ stroke: 'var(--muted-foreground)', strokeWidth: 1, strokeDasharray: '4 4' }}
                                isAnimationActive={false}
                            />

                            {/* Equity Rate - Blue */}
                            {visible.equity && (
                                <Line
                                    type="monotone"
                                    dataKey="equityRate"
                                    name="淨值"
                                    stroke="var(--chart-blue)"
                                    strokeWidth={2}
                                    dot={false}
                                    activeDot={{ r: 4, strokeWidth: 0, fill: 'var(--chart-blue)' }}
                                />
                            )}

                            {/* Premium Rate - Orange */}
                            {visible.premium && (
                                <Line
                                    type="monotone"
                                    dataKey="premiumRate"
                                    name="期權收益"
                                    stroke="var(--chart-orange)"
                                    strokeWidth={2}
                                    dot={false}
                                    activeDot={{ r: 4, strokeWidth: 0, fill: 'var(--chart-orange)' }}
                                />
                            )}

                            {/* Exposure Adjustment vertical dashed lines */}
                            {chartData
                                .filter(d => d.exposure_adjustment && d.exposure_adjustment !== 'none')
                                .map((d, i) => (
                                    <ReferenceLine
                                        key={`exposure-${i}`}
                                        x={d.dateStr}
                                        stroke="#6b7280"
                                        strokeDasharray="4 4"
                                        strokeWidth={1.5}
                                        opacity={0.7}
                                    />
                                ))}
                        </LineChart>
                    </ResponsiveContainer>
                )}
            </div>

            {/* Interactive Legend */}
            <div className="h-8 flex items-center justify-center gap-6 text-xs border-t bg-muted/10 select-none">
                <button
                    onClick={(e) => { e.stopPropagation(); toggle('equity'); }}
                    className={`flex items-center gap-1.5 transition-all px-2 py-1 rounded-md hover:bg-black/5 dark:hover:bg-card/10 ${visible.equity ? 'opacity-100' : 'opacity-50 grayscale'}`}
                >
                    <div className="w-2 h-2 rounded-full bg-chart-blue" />
                    <span className="text-muted-foreground font-medium">淨值</span>
                </button>
                <button
                    onClick={(e) => { e.stopPropagation(); toggle('premium'); }}
                    className={`flex items-center gap-1.5 transition-all px-2 py-1 rounded-md hover:bg-black/5 dark:hover:bg-card/10 ${visible.premium ? 'opacity-100' : 'opacity-50 grayscale'}`}
                >
                    <div className="w-2 h-2 rounded-full bg-chart-orange" />
                    <span className="text-muted-foreground font-medium">期權收益</span>
                </button>
            </div>
        </div>
    );
}
