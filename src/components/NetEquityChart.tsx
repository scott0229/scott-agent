'use client';

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, Legend } from 'recharts';

interface NetEquityChartProps {
    data: { date: number; net_equity: number }[];
    initialCost?: number;
    id?: string | number; // Add ID for unique gradient identifier
}

export function NetEquityChart({ data, initialCost, id }: NetEquityChartProps) {
    if (!data || data.length === 0) {
        return (
            <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">
                無歷史資料
            </div>
        );
    }

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
            : ((item.net_equity - baseValue) / baseValue) * 100
    }));

    const formatPercent = (value: number) => {
        return `${value.toFixed(1)}%`;
    };

    const gradientId = `colorRate-${id || Math.random()}`;

    // Calculate 5 evenly spaced ticks (to hide first and show 4)
    const ticks = [];
    if (chartData.length > 0) {
        const count = 5;
        const step = (chartData.length - 1) / (count - 1);
        for (let i = 0; i < count; i++) {
            const index = Math.round(i * step);
            if (index < chartData.length) {
                ticks.push(chartData[index].dateStr);
            }
        }
    }

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
        <div className="relative w-full h-full border rounded-md">

            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 20, right: 30, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />
                    <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" opacity={0.3} />
                    <XAxis
                        dataKey="dateStr"
                        tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                        ticks={ticks.slice(1)}
                        interval={0}
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
                        itemStyle={{ color: 'hsl(var(--foreground))', fontSize: '13px', fontWeight: 500 }}
                        labelStyle={{ color: 'hsl(var(--muted-foreground))', fontSize: '12px', marginBottom: '4px' }}
                        formatter={(value: any) => [`${Number(value).toFixed(2)}%`, '淨值率']}
                        labelFormatter={(label) => `日期: ${label}`}
                        cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeWidth: 1, strokeDasharray: '4 4' }}
                    />

                    <Line
                        type="monotone"
                        dataKey="rate"
                        name="帳戶"
                        stroke="#2563eb"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4, strokeWidth: 0, fill: '#2563eb' }}
                    />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}
