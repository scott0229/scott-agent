'use client';

import { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, Legend } from 'recharts';

interface NetEquityChartProps {
    data: { date: number; net_equity: number; rate?: number; qqq_rate?: number; qld_rate?: number; exposure_adjustment?: string }[];
    initialCost?: number;
    id?: string | number; // Add ID for unique gradient identifier
    name?: string;
}

export function NetEquityChart({ data, initialCost, id, name }: NetEquityChartProps) {
    const [visible, setVisible] = useState({ account: true, qqq: true, qld: true });
    const toggle = (key: keyof typeof visible) => setVisible(prev => ({ ...prev, [key]: !prev[key] }));

    const accountLabel = name || '帳戶';

    // Early check moved inside render to preserve layout
    const hasData = data && data.length > 0;

    // Determine base cost
    const baseValue = initialCost && initialCost > 0 ? initialCost : (data[0]?.net_equity || 1);

    // Debug log for troubleshooting "empty" charts
    if (process.env.NODE_ENV === 'development') {
        // console.log(`Chart ${id}: Base=${baseValue}, First=${data[0]?.net_equity}, Rate=${((data[data.length-1].net_equity - baseValue)/baseValue)*100}%`);
    }

    // Format data for recharts
    const chartData = data.map(item => ({
        date: item.date,
        dateStr: new Date(item.date * 1000).toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' }),
        // Prioritize backend-provided 'rate' (TWR), fallback to legacy simple calculation if missing
        rate: (item as any).rate !== undefined
            ? (item as any).rate
            : ((item.net_equity - baseValue) / baseValue) * 100,
        qqq_rate: (item as any).qqq_rate,
        qld_rate: (item as any).qld_rate,
        exposure_adjustment: (item as any).exposure_adjustment
    }));

    const formatPercent = (value: number) => {
        return `${value.toFixed(1)}%`;
    };

    const gradientId = `colorRate-${id || Math.random()}`;

    const CustomYTick = (props: any) => {
        const { x, y, payload, index } = props;
        // Hide the first tick (bottom-most)
        if (index === 0) return null;

        return (
            <text
                x={x}
                y={y}
                dy={4}
                textAnchor="end"
                fill="hsl(var(--muted-foreground))"
                fontSize={12}
            >
                {formatPercent(payload.value)}
            </text>
        );
    };

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
                        <LineChart data={chartData} margin={{ top: 20, right: 30, left: 10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />
                            <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" opacity={0.3} />
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
                            <YAxis
                                tick={CustomYTick}
                                tickCount={5}
                                width={45}
                                domain={['auto', 'auto']}
                                axisLine={false}
                                tickLine={false}
                            />
                            <Tooltip
                                contentStyle={{
                                    backgroundColor: 'hsl(var(--popover))',
                                    border: '1px solid hsl(var(--border))',
                                    borderRadius: 'var(--radius)',
                                    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                                    padding: '8px 12px'
                                }}
                                itemStyle={{ color: 'hsl(var(--foreground))', fontSize: '12px', fontWeight: 'normal', padding: 0 }}
                                labelStyle={{ color: 'hsl(var(--muted-foreground))', fontSize: '12px', marginBottom: '2px', fontWeight: 'normal' }}
                                formatter={(value: any, name: any) => {
                                    let label = name;
                                    if (name === 'rate') label = accountLabel;
                                    if (name === 'qqq_rate') label = 'QQQ';
                                    if (name === 'qld_rate') label = 'QLD';
                                    return [`${Number(value).toFixed(2)}%`, label];
                                }}
                                labelFormatter={(label) => `日期 : ${label}`}
                                itemSorter={(item) => {
                                    if (item.name === 'rate') return 0;
                                    if (item.name === 'qqq_rate') return 1;
                                    if (item.name === 'qld_rate') return 2;
                                    return 3;
                                }}
                                cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeWidth: 1, strokeDasharray: '4 4' }}
                            />

                            {/* QQQ - Green */}
                            {
                                visible.qqq && (
                                    <Line
                                        type="monotone"
                                        dataKey="qqq_rate"
                                        name="qqq_rate"
                                        stroke="#22c55e"
                                        strokeWidth={2}
                                        dot={false}
                                        activeDot={{ r: 4, strokeWidth: 0, fill: '#22c55e' }}
                                    />
                                )
                            }

                            {/* QLD - Orange */}
                            {
                                visible.qld && (
                                    <Line
                                        type="monotone"
                                        dataKey="qld_rate"
                                        name="qld_rate"
                                        stroke="#f97316"
                                        strokeWidth={2}
                                        dot={false}
                                        activeDot={{ r: 4, strokeWidth: 0, fill: '#f97316' }}
                                    />
                                )
                            }

                            {/* User - Blue (Rendered last to appear on top) */}
                            {
                                visible.account && (
                                    <Line
                                        type="monotone"
                                        dataKey="rate"
                                        name="rate"
                                        stroke="#2563eb"
                                        strokeWidth={2}
                                        dot={false}
                                        activeDot={{ r: 4, strokeWidth: 0, fill: '#2563eb' }}
                                    />
                                )
                            }

                            {/* Exposure Adjustment vertical lines */}
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
                        </LineChart >
                    </ResponsiveContainer >
                )}
            </div >

            {/* Interactive Legend */}
            < div className="h-8 flex items-center justify-center gap-6 text-xs border-t bg-muted/10 select-none" >
                <button
                    onClick={(e) => { e.stopPropagation(); toggle('account'); }}
                    className={`flex items-center gap-1.5 transition-all px-2 py-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10 ${visible.account ? 'opacity-100' : 'opacity-50 grayscale'}`}
                >
                    <div className="w-2 h-2 rounded-full bg-[#2563eb]" />
                    <span className="text-muted-foreground font-medium">{accountLabel}</span>
                </button>
                <button
                    onClick={(e) => { e.stopPropagation(); toggle('qqq'); }}
                    className={`flex items-center gap-1.5 transition-all px-2 py-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10 ${visible.qqq ? 'opacity-100' : 'opacity-50 grayscale'}`}
                >
                    <div className="w-2 h-2 rounded-full bg-[#22c55e]" />
                    <span className="text-muted-foreground font-medium">QQQ</span>
                </button>
                <button
                    onClick={(e) => { e.stopPropagation(); toggle('qld'); }}
                    className={`flex items-center gap-1.5 transition-all px-2 py-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10 ${visible.qld ? 'opacity-100' : 'opacity-50 grayscale'}`}
                >
                    <div className="w-2 h-2 rounded-full bg-[#f97316]" />
                    <span className="text-muted-foreground font-medium">QLD</span>
                </button>
            </div >
        </div >
    );
}
