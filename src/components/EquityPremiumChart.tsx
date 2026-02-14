'use client';

import { useState } from 'react';
import {
    LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
    CartesianGrid, ReferenceLine
} from 'recharts';

interface DailyPremium {
    date: number;
    cumulative_profit: number;
}

interface Deposit {
    date: number;
    amount: number;
}

interface EquityPremiumChartProps {
    equityHistory: { date: number; net_equity: number; rate: number; exposure_adjustment?: string }[];
    dailyPremium: DailyPremium[];
    initialCost: number;
    netDeposit: number;
    deposits: Deposit[];
    name?: string;
}

export function EquityPremiumChart({ equityHistory, dailyPremium, initialCost, netDeposit, deposits, name }: EquityPremiumChartProps) {
    const [visible, setVisible] = useState({ equity: true, premium: true });
    const toggle = (key: keyof typeof visible) => setVisible(prev => ({ ...prev, [key]: !prev[key] }));

    const hasData = equityHistory && equityHistory.length > 0;
    const hasDetailedDeposits = deposits && deposits.length > 0;

    // Sort deposits by date for efficient lookup
    const sortedDeposits = [...(deposits || [])].sort((a, b) => a.date - b.date);

    // Sort premium entries by date
    const sortedPremiumDates = dailyPremium
        ? [...dailyPremium].sort((a, b) => a.date - b.date)
        : [];

    // Build chart data
    const chartData = (equityHistory || []).map(item => {
        const d = new Date(item.date * 1000);

        // Compute cost base: use detailed deposits if available, else fallback to static total
        let costBase: number;
        if (hasDetailedDeposits) {
            costBase = initialCost;
            for (const dep of sortedDeposits) {
                if (dep.date <= item.date) {
                    costBase += dep.amount;
                } else {
                    break;
                }
            }
        } else {
            // Fallback: use total (initial_cost + net_deposit)
            costBase = initialCost + netDeposit;
        }
        if (costBase <= 0) costBase = 1; // safety

        // Find the latest cumulative premium on or before this date
        let cumPremium = 0;
        for (const dp of sortedPremiumDates) {
            if (dp.date <= item.date) {
                cumPremium = dp.cumulative_profit;
            } else {
                break;
            }
        }

        // Use TWR rate directly for equity; compute premium rate from daily cost base
        const premiumRate = (cumPremium / costBase) * 100;

        return {
            date: item.date,
            dateStr: `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`,
            equityRate: item.rate,
            premiumRate,
            rawEquity: item.net_equity,
            rawPremium: cumPremium,
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
                                tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
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
                                        <text x={x} y={y} dy={4} textAnchor="end" fill="hsl(var(--muted-foreground))" fontSize={12}>
                                            {formatPercent(payload.value)}
                                        </text>
                                    );
                                }}
                                tickCount={6}
                                width={50}
                                domain={['auto', 'auto']}
                                axisLine={false}
                                tickLine={false}
                            />
                            {/* 0% reference line */}
                            <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeOpacity={0.3} />
                            <Tooltip
                                content={({ active, payload, label }) => {
                                    if (!active || !payload || payload.length === 0) return null;
                                    const dataPoint = payload[0]?.payload;
                                    const exposureVal = dataPoint?.exposure_adjustment;
                                    const exposureLabel = exposureVal === 'buy_qqq' ? '買入QQQ' : exposureVal === 'buy_qld' ? '買入QLD' : null;

                                    return (
                                        <div style={{
                                            backgroundColor: 'hsl(var(--popover))',
                                            padding: '8px 12px',
                                            fontSize: '12px'
                                        }}>
                                            <div style={{ color: '#374151', marginBottom: '4px', fontWeight: 500, backgroundColor: '#f3f4f6', padding: '2px 6px', borderRadius: '4px' }}>
                                                日期 : {label}
                                            </div>
                                            {exposureLabel && (
                                                <div style={{ color: '#111827', marginBottom: '4px' }}>
                                                    調倉：{exposureLabel}
                                                </div>
                                            )}
                                            {dataPoint && visible.equity && (
                                                <div style={{ color: '#1d4ed8', padding: 0 }}>
                                                    淨值 : {dataPoint.equityRate.toFixed(2)}% ({Math.round(dataPoint.rawEquity).toLocaleString()})
                                                </div>
                                            )}
                                            {dataPoint && visible.premium && (
                                                <div style={{ color: '#c2410c', padding: 0 }}>
                                                    權利金 : {dataPoint.premiumRate.toFixed(2)}% ({Math.round(dataPoint.rawPremium).toLocaleString()})
                                                </div>
                                            )}
                                        </div>
                                    );
                                }}
                                position={{ x: 50, y: 5 }}
                                contentStyle={{ border: 'none', padding: 0, background: 'transparent', boxShadow: 'none' }}
                                wrapperStyle={{ pointerEvents: 'none', zIndex: 10, outline: 'none', border: 'none', boxShadow: 'none' }}
                                itemStyle={{ border: 'none' }}
                                cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeWidth: 1, strokeDasharray: '4 4' }}
                                isAnimationActive={false}
                            />

                            {/* Equity Rate - Blue */}
                            {visible.equity && (
                                <Line
                                    type="monotone"
                                    dataKey="equityRate"
                                    name="淨值"
                                    stroke="#2563eb"
                                    strokeWidth={2}
                                    dot={false}
                                    activeDot={{ r: 4, strokeWidth: 0, fill: '#2563eb' }}
                                />
                            )}

                            {/* Premium Rate - Orange */}
                            {visible.premium && (
                                <Line
                                    type="monotone"
                                    dataKey="premiumRate"
                                    name="權利金"
                                    stroke="#f97316"
                                    strokeWidth={2}
                                    dot={false}
                                    activeDot={{ r: 4, strokeWidth: 0, fill: '#f97316' }}
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
                    className={`flex items-center gap-1.5 transition-all px-2 py-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10 ${visible.equity ? 'opacity-100' : 'opacity-50 grayscale'}`}
                >
                    <div className="w-2 h-2 rounded-full bg-[#2563eb]" />
                    <span className="text-muted-foreground font-medium">淨值</span>
                </button>
                <button
                    onClick={(e) => { e.stopPropagation(); toggle('premium'); }}
                    className={`flex items-center gap-1.5 transition-all px-2 py-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10 ${visible.premium ? 'opacity-100' : 'opacity-50 grayscale'}`}
                >
                    <div className="w-2 h-2 rounded-full bg-[#f97316]" />
                    <span className="text-muted-foreground font-medium">權利金</span>
                </button>
            </div>
        </div>
    );
}
