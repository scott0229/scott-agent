'use client';

import { useState, useEffect } from 'react';
import { useYearFilter } from '@/contexts/YearFilterContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Copy, FilterX } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { US_MARKET_HOLIDAYS, isMarketHoliday, getTradingDaysDiff } from '@/lib/holidays';
import { generateDailyTradesText } from '@/lib/daily-trades-text';
import { Skeleton } from '@/components/ui/skeleton';
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import {
    LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
    CartesianGrid, ReferenceLine,
} from 'recharts';

export default function DailyTradesPage() {
    const { selectedYear } = useYearFilter();
    const [date, setDate] = useState<string>('');
    const [data, setData] = useState<any[]>([]);
    const [marketDataMap, setMarketDataMap] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState(true);
    const [availableDates, setAvailableDates] = useState<string[]>([]);
    const [isCalendarOpen, setIsCalendarOpen] = useState(false);
    const [selectedAccount, setSelectedAccount] = useState<string>('all');
    const [allAccounts, setAllAccounts] = useState<any[]>([]);
    const [historyData, setHistoryData] = useState<{ date: string; profit: number }[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const { toast } = useToast();

    useEffect(() => {
        const fetchUsers = async () => {
            try {
                const res = await fetch(`/api/users?mode=selection&year=${selectedYear}`);
                if (res.ok) {
                    const json = await res.json();
                    setAllAccounts(json.users || []);
                }
            } catch (err) {
                console.error(err);
            }
        };
        fetchUsers();
    }, [selectedYear]);

    // Initialize date to the latest date with data, or fallback to the last valid trading day
    useEffect(() => {
        const initDate = async () => {
            try {
                const res = await fetch(`/api/daily-trades/latest-date?year=${selectedYear}`);
                if (res.ok) {
                    const json = await res.json();
                    if (json.availableDates) {
                        setAvailableDates(json.availableDates);
                    }
                    if (json.latestDate) {
                        setDate(json.latestDate);
                        return;
                    }
                }
            } catch (err) {
                console.error('Failed to fetch latest date', err);
            }

            // Fallback: Keep going back until we find a non-weekend, non-holiday day
            let current = new Date();
            while (true) {
                const dayOfWeek = current.getDay();
                if (dayOfWeek !== 0 && dayOfWeek !== 6 && !isMarketHoliday(current)) {
                    break;
                }
                current.setDate(current.getDate() - 1);
            }
            
            const y = current.getFullYear();
            const m = String(current.getMonth() + 1).padStart(2, '0');
            const d = String(current.getDate()).padStart(2, '0');
            setDate(`${y}-${m}-${d}`);
        };
        initDate();
    }, [selectedYear]);

    useEffect(() => {
        if (!date) return;

        const fetchData = async () => {
            setLoading(true);
            try {
                const res = await fetch(`/api/daily-trades?date=${date}&year=${selectedYear}`);
                if (res.ok) {
                    const json = await res.json();
                    setData(json.data || []);
                    setMarketDataMap(json.marketData || {});
                } else {
                    setData([]);
                    setMarketDataMap({});
                }
            } catch (err) {
                console.error(err);
                setData([]);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [date, selectedYear]);

    // Single-account mode chart: 30-day option-收益 history for the
    // selected user. Skip the fetch in 'all' mode — chart is hidden.
    useEffect(() => {
        if (selectedAccount === 'all' || !date) {
            setHistoryData([]);
            return;
        }
        let cancelled = false;
        const fetchHistory = async () => {
            setHistoryLoading(true);
            try {
                const url = `/api/daily-trades/history?user_id=${encodeURIComponent(selectedAccount)}&endDate=${date}&days=30&year=${selectedYear}`;
                const res = await fetch(url);
                if (cancelled) return;
                if (res.ok) {
                    const json = await res.json();
                    setHistoryData(json.history || []);
                } else {
                    setHistoryData([]);
                }
            } catch (err) {
                console.error('Failed to fetch history', err);
                if (!cancelled) setHistoryData([]);
            } finally {
                if (!cancelled) setHistoryLoading(false);
            }
        };
        fetchHistory();
        return () => { cancelled = true; };
    }, [selectedAccount, date, selectedYear]);

    const changeDate = (offset: number) => {
        if (!date) return;
        
        if (availableDates.length > 0) {
            const currentIndex = availableDates.indexOf(date);
            if (currentIndex !== -1) {
                const nextIndex = currentIndex - offset;
                if (nextIndex >= 0 && nextIndex < availableDates.length) {
                    setDate(availableDates[nextIndex]);
                }
                return;
            } else {
                // Current date is not in availableDates (e.g. empty weekend or typed URL)
                // Find nearest available date based on direction
                if (offset > 0) {
                    // Find older date
                    const older = availableDates.find(d => d < date);
                    if (older) {
                        setDate(older);
                        return;
                    }
                } else {
                    // Find newer date
                    const newer = [...availableDates].reverse().find(d => d > date);
                    if (newer) {
                        setDate(newer);
                        return;
                    }
                }
                // Fallback to latest available date
                setDate(availableDates[0]);
                return;
            }
        }
        
        const current = new Date(date);
        current.setDate(current.getDate() + offset);
        
        const y = current.getFullYear();
        const m = String(current.getMonth() + 1).padStart(2, '0');
        const d = String(current.getDate()).padStart(2, '0');
        setDate(`${y}-${m}-${d}`);
    };

    const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setDate(e.target.value);
    };

    const formatMoney = (val: number | null | undefined) => {
        if (val == null) return '-';
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(val);
    };

    const formatNumber = (val: number | null | undefined) => {
        if (val == null) return '-';
        return new Intl.NumberFormat('en-US').format(val);
    };

    const generateTradesText = (userGroup: any) => generateDailyTradesText(userGroup, date, marketDataMap);


    const filteredData = selectedAccount === 'all' ? data : data.filter((group: any) => group.user?.user_id === selectedAccount);

    return (
        <div className="container mx-auto py-10 max-w-[1400px]">
            <div className="mb-8 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <h1 className="text-3xl font-bold">當日交易</h1>
                
                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="icon"
                        className="h-10 w-10 bg-card/50 dark:bg-black/50"
                        onClick={() => {
                            setSelectedAccount('all');
                            if (availableDates && availableDates.length > 0) {
                                const maxDate = availableDates.reduce((a, b) => a > b ? a : b);
                                setDate(maxDate);
                            }
                        }}
                    >
                        <FilterX className="h-4 w-4 text-muted-foreground" />
                    </Button>
                    <Select value={selectedAccount} onValueChange={setSelectedAccount}>
                        <SelectTrigger className="w-[140px] h-10 bg-card/50 dark:bg-black/50">
                            <SelectValue placeholder="全部帳戶" />
                        </SelectTrigger>
                        <SelectContent className="max-h-none">
                            <SelectItem value="all">全部帳戶</SelectItem>
                            {[...allAccounts]
                                .sort((a, b) => (a.user_id || '').localeCompare(b.user_id || ''))
                                .map(user => (
                                    <SelectItem key={user.user_id} value={user.user_id}>
                                        {user.user_id}
                                    </SelectItem>
                                ))}
                        </SelectContent>
                    </Select>

                    <div className="flex items-center h-10 bg-card/50 dark:bg-black/50 rounded-md border shadow-sm">
                        <Button variant="ghost" size="icon" className="h-full rounded-r-none" onClick={() => changeDate(-1)}>
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <Popover modal={true} open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                            <PopoverTrigger asChild>
                                <Button
                                    variant={"ghost"}
                                    className={cn(
                                        "w-[140px] h-full justify-center text-center font-normal px-2 hover:bg-transparent rounded-none border-x border-border/50",
                                        !date && "text-muted-foreground"
                                    )}
                                >
                                {date ? (
                                    <span>
                                        {date.replace(/-/g, '/')} ({['日', '一', '二', '三', '四', '五', '六'][new Date(date).getDay()]})
                                    </span>
                                ) : <span>選擇日期</span>}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="center">
                            <Calendar
                                mode="single"
                                selected={date ? new Date(date) : undefined}
                                onSelect={(selectedDate) => {
                                    if (selectedDate) {
                                        const y = selectedDate.getFullYear();
                                        const m = String(selectedDate.getMonth() + 1).padStart(2, '0');
                                        const d = String(selectedDate.getDate()).padStart(2, '0');
                                        setDate(`${y}-${m}-${d}`);
                                        setIsCalendarOpen(false);
                                    }
                                }}
                                disabled={(d) => {
                                    if (d.getDay() === 0 || d.getDay() === 6 || isMarketHoliday(d)) return true;
                                    if (availableDates && availableDates.length > 0) {
                                        const y = d.getFullYear();
                                        const m = String(d.getMonth() + 1).padStart(2, '0');
                                        const day = String(d.getDate()).padStart(2, '0');
                                        const dateStr = `${y}-${m}-${day}`;
                                        return !availableDates.includes(dateStr);
                                    }
                                    return false;
                                }}
                                initialFocus
                            />
                            </PopoverContent>
                        </Popover>
                        <Button variant="ghost" size="icon" className="h-full rounded-l-none" onClick={() => changeDate(1)}>
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {[1, 2, 3, 4].map(i => (
                        <div key={i} className="bg-card rounded-lg border shadow-sm p-4 flex flex-col h-[200px]">
                            <div className="flex items-center justify-between mb-2">
                                <Skeleton className="h-5 w-32" />
                                <Skeleton className="h-6 w-6 rounded-md" />
                            </div>
                            <div className="space-y-3 mt-4">
                                <Skeleton className="h-4 w-3/4" />
                                <Skeleton className="h-4 w-full" />
                                <Skeleton className="h-4 w-5/6" />
                            </div>
                        </div>
                    ))}
                </div>
            ) : filteredData.length === 0 ? (
                selectedAccount !== 'all' ? (
                    // Single-account mode with no trades on this date: still surface the
                    // 30-day chart on the right so the user keeps context while scrubbing
                    // through quiet days.
                    <div className="grid grid-cols-1 lg:grid-cols-[minmax(280px,360px)_1fr] gap-4">
                        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground bg-muted/20 rounded-lg border border-dashed">
                            <CalendarIcon className="h-10 w-10 mb-3 opacity-20" />
                            <p className="text-sm">這個日期沒有任何交易記錄</p>
                        </div>
                        <DailyProfitHistoryChart
                            data={historyData}
                            loading={historyLoading}
                        />
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground bg-muted/20 rounded-lg border border-dashed">
                        <CalendarIcon className="h-12 w-12 mb-4 opacity-20" />
                        <p className="text-lg">這個日期沒有任何交易記錄</p>
                    </div>
                )
            ) : (
                // Single-account mode → 2-col layout: card on the left, 30-day option-收益
                // line chart on the right. Use a fixed ~360px left column so the chart
                // gets the wide canvas; fall back to a single column on narrow viewports.
                // 'All' mode keeps the original 1→4 col responsive grid.
                <div className={cn(
                    "gap-4",
                    selectedAccount !== 'all' && filteredData.length === 1
                        ? "grid grid-cols-1 lg:grid-cols-[minmax(280px,360px)_1fr]"
                        : "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                )}>
                    {filteredData.map((userGroup: any) => {
                        const reportText = generateTradesText(userGroup);
                        const userName = userGroup.user.name || userGroup.user.user_id;

                        // Sum option-only 收益 and 權利金 amounts → day's option cash
                        // inflow. Iterate per-line and skip stock close lines (they
                        // start with 買/賣 and include the 股 keyword), so the option
                        // 收益 / 權利金 numbers are the only contributors. This avoids
                        // relying on punctuation (the stock format now matches option
                        // formatting with a halfwidth 「, 」).
                        let dayProfit = 0;
                        for (const line of reportText.split('\n')) {
                            if (/^(買|賣)/.test(line) && line.includes(' 股 ')) continue;
                            for (const m of line.matchAll(/(?:收益|權利金)\s*([+-]?[\d,]+(?:\.\d+)?)/g)) {
                                dayProfit += parseFloat(m[1].replace(/,/g, ''));
                            }
                        }
                        const profitStr = `${dayProfit > 0 ? '+' : ''}${dayProfit.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}`;
                        const profitColor = dayProfit > 0 ? 'text-status-positive' : dayProfit < 0 ? 'text-status-negative' : 'text-muted-foreground';

                        const cardUid = userGroup.user?.user_id as string | undefined;
                        const isFilteredToThis = !!cardUid && selectedAccount === cardUid;
                        return (
                            <div
                                key={userGroup.user.id}
                                className={cn(
                                    "bg-card rounded-lg border shadow-sm p-4 flex flex-col transition-colors",
                                    isFilteredToThis && "ring-2 ring-primary/40"
                                )}
                                onDoubleClick={(e) => {
                                    // Double-click anywhere on the card toggles single-account
                                    // filter for this user. Double-clicking again (while
                                    // already filtered to this card) clears the filter.
                                    if (!cardUid) return;
                                    e.preventDefault();
                                    setSelectedAccount(isFilteredToThis ? 'all' : cardUid);
                                }}
                            >
                                <div className="flex items-center justify-between mb-2">
                                    <h3 className="font-semibold text-sm whitespace-nowrap">
                                        {userName}
                                        <span className="text-muted-foreground font-normal"> - 收益 </span>
                                        <span className={profitColor}>{profitStr}</span>
                                    </h3>
                                    <div className="flex gap-0.5 items-center">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-6 w-6"
                                            onClick={() => {
                                                const dateStr = date ? `- ${date.substring(5).replace('-', '/')} ` : '';
                                                const fullText = `${userName} ${dateStr}交易記錄\n${reportText}`;
                                                navigator.clipboard.writeText(fullText);
                                                toast({ title: "已複製", description: `${userName} 的交易記錄已複製` });
                                            }}
                                            onDoubleClick={(e) => e.stopPropagation()}
                                        >
                                            <Copy className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                </div>
                                <pre className="font-mono text-sm whitespace-pre-wrap flex-1 leading-relaxed">
                                    {reportText.split('\n').map((line, i, arr) => {
                                        const isRollHighlight = line.includes('展期') || line.startsWith('開新倉') || line.startsWith('平倉') || line.startsWith('到期');
                                        
                                        const parts = line.split(/((?:收益|損益|權利金) [+-]?[\d,]+(?:\.\d+)?|被突破 [\d,]+(?:\.\d+)?|被行權)/);
                                        const renderedParts = parts.map((part, pIndex) => {
                                            if (part.startsWith('收益 ') || part.startsWith('損益 ') || part.startsWith('權利金 ')) {
                                                const prefix = part.startsWith('收益 ') ? '收益 ' : part.startsWith('損益 ') ? '損益 ' : '權利金 ';
                                                const numStr = part.replace(prefix, '');
                                                const num = parseFloat(numStr.replace(/,/g, ''));
                                                const colorClass = num > 0 ? 'text-status-positive' : num < 0 ? 'text-status-negative' : '';
                                                return <span key={pIndex}>{prefix}<span className={colorClass}>{numStr}</span></span>;
                                            } else if (part.startsWith('被突破 ') || part === '被行權') {
                                                return <span key={pIndex} className="text-status-negative">{part}</span>;
                                            }
                                            return <span key={pIndex}>{part}</span>;
                                        });

                                        return (
                                            <span key={i}>
                                                <span className={isRollHighlight ? 'cell-note px-1 rounded font-medium' : ''}>
                                                    {renderedParts}
                                                </span>
                                                {i < arr.length - 1 ? '\n' : ''}
                                            </span>
                                        );
                                    })}
                                </pre>
                            </div>
                        );
                    })}
                    {selectedAccount !== 'all' && filteredData.length === 1 && (
                        <DailyProfitHistoryChart
                            data={historyData}
                            loading={historyLoading}
                        />
                    )}
                </div>
            )}
        </div>
    );
}

interface DailyProfitHistoryChartProps {
    data: { date: string; profit: number }[];
    loading: boolean;
}

// Recharts' Tooltip emits the active payload through its content prop. We
// mount a zero-render bridge that just useEffect's the active point upward
// so the parent's always-on panel can re-render with the hovered date.
function TooltipBridge({
    active,
    payload,
    onChange,
}: {
    active?: boolean;
    payload?: { payload?: { date: string; profit: number } }[];
    onChange: (p: { date: string; profit: number } | null) => void;
}) {
    const point = active && payload?.[0]?.payload ? payload[0].payload : null;
    const key = point ? `${point.date}|${point.profit}` : '';
    useEffect(() => {
        onChange(point);
        // Depend on key so identical-point re-renders don't trigger setState.
        // onChange is React's useState setter — stable across renders.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);
    return null;
}

function DailyProfitHistoryChart({ data, loading }: DailyProfitHistoryChartProps) {
    // Track which data point is currently hovered. The info panel at the
    // top-left renders the hovered point — or the most recent day when no
    // hover is active — so the user always sees a date + 收益 number even
    // before they interact. Hover state is fed in by TooltipBridge below,
    // which mounts as Recharts' Tooltip content so we get callbacks every
    // time the active point changes.
    const [hoveredPoint, setHoveredPoint] = useState<{ date: string; profit: number } | null>(null);

    if (loading) {
        return (
            <div className="bg-card rounded-lg border shadow-sm p-4 flex flex-col">
                <div className="text-sm font-semibold mb-2">過去 30 個交易日收益</div>
                <Skeleton className="flex-1 h-[280px]" />
            </div>
        );
    }
    if (!data || data.length === 0) {
        return (
            <div className="bg-card rounded-lg border shadow-sm p-4 flex flex-col">
                <div className="text-sm font-semibold mb-2">過去 30 個交易日收益</div>
                <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm py-12">
                    沒有歷史資料
                </div>
            </div>
        );
    }

    // X-axis is the MM-DD slice of YYYY-MM-DD; full date stays on the tooltip.
    // Y-axis uses a signed-sqrt transform so days at ±10 don't get crushed flat
    // by days at ±2,000. Linear scale loses every quiet day to a single peak;
    // log can't span zero or negatives. sgn(x)·√|x| is symmetric, monotone, and
    // continuous through zero, so the line stays visually sensible at both
    // extremes. Ticks below are chosen in raw $ space and then projected.
    const sgnSqrt = (x: number) => Math.sign(x) * Math.sqrt(Math.abs(x));
    const chartData = data.map(d => ({
        ...d,
        label: d.date.substring(5),
        profitSqrt: sgnSqrt(d.profit),
    }));

    // Pick raw $ tick magnitudes that bracket the data, then project into
    // signed-sqrt space so the axis labels still read in dollars.
    const CANDIDATE_MAGS = [1000, 3000, 10000, 30000];
    const dataMaxAbs = Math.max(1, ...data.map(d => Math.abs(d.profit)));
    const usefulMags = CANDIDATE_MAGS.filter(m => m <= dataMaxAbs * 1.5);
    const tickPoolRaw = usefulMags.length > 0
        ? [...usefulMags.map(m => -m).reverse(), 0, ...usefulMags]
        : [-1000, 0, 1000];
    const tickPoolSqrt = tickPoolRaw.map(sgnSqrt);
    const yDomain: [number, number] = [tickPoolSqrt[0], tickPoolSqrt[tickPoolSqrt.length - 1]];

    // Default the info panel to the most recent day so the user sees a
    // populated date + 收益 even before they hover.
    const lastPoint = data[data.length - 1];
    const panelPoint = hoveredPoint ?? lastPoint;
    const panelProfitStr = panelPoint
        ? `${panelPoint.profit > 0 ? '+' : ''}${panelPoint.profit.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}`
        : '';
    const panelProfitColor = panelPoint
        ? (panelPoint.profit > 0 ? 'text-status-positive' : panelPoint.profit < 0 ? 'text-status-negative' : 'text-muted-foreground')
        : 'text-muted-foreground';

    return (
        <div className="bg-card rounded-lg border shadow-sm p-4 flex flex-col min-h-[360px]">
            <div className="relative mb-2 min-h-[20px]">
                {/* Title floats centered above the chart so it sits over the plot
                    area rather than crowding the y-axis side of the card. */}
                <div className="absolute left-1/2 -translate-x-1/2 text-sm font-semibold whitespace-nowrap">
                    過去 30 個交易日收益
                </div>
            </div>
            <div className="relative flex-1 min-h-[300px] [&_*:focus]:outline-none [&_*:focus-visible]:outline-none">
                {/* Always-visible info panel pinned to the top-left of the
                    plot area. Shows the hovered point if any, otherwise the
                    most recent day so there's no empty state. */}
                {panelPoint && (
                    <div className="absolute top-4 left-16 z-10 pointer-events-none text-xs leading-tight">
                        <div className="font-medium">{panelPoint.date}</div>
                        <div>
                            <span className="text-muted-foreground">收益 </span>
                            <span className={cn("font-semibold", panelProfitColor)}>{panelProfitStr}</span>
                        </div>
                    </div>
                )}
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                        data={chartData}
                        margin={{ top: 8, right: 16, left: 0, bottom: 4 }}
                    >
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis
                            dataKey="label"
                            tick={{ fontSize: 11, fill: 'var(--foreground)' }}
                            interval="preserveStartEnd"
                            minTickGap={20}
                        />
                        <YAxis
                            tick={{ fontSize: 11, fill: 'var(--foreground)' }}
                            ticks={tickPoolSqrt}
                            domain={yDomain}
                            tickMargin={4}
                            tickFormatter={(v) => {
                                // Invert the signed-sqrt and round to the nearest 10
                                // so projected ticks always read as clean $ values.
                                const raw = Math.sign(v) * v * v;
                                const rounded = Math.round(raw / 10) * 10;
                                // Drop the bottom-most tick label — its baseline
                                // collides with the x-axis date row underneath.
                                if (rounded === Math.round(tickPoolRaw[0] / 10) * 10) return '';
                                if (rounded === 0) return '0';
                                return rounded.toLocaleString('en-US');
                            }}
                            width={48}
                        />
                        <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeDasharray="2 2" strokeOpacity={0.5} />
                        {/* Tooltip renders the dashed crosshair and, via TooltipBridge,
                            relays the active point up to hoveredPoint state. The visible
                            readout is the always-on panel above; TooltipBridge itself
                            returns null so nothing floats with the cursor. */}
                        <Tooltip
                            cursor={{ stroke: 'var(--muted-foreground)', strokeWidth: 1, strokeDasharray: '4 4' }}
                            content={<TooltipBridge onChange={setHoveredPoint} />}
                            isAnimationActive={false}
                        />
                        <Line
                            type="monotone"
                            dataKey="profitSqrt"
                            stroke="var(--chart-blue, #60a5fa)"
                            strokeWidth={2}
                            dot={(props: { cx?: number; cy?: number; payload?: { profit: number; date: string } }) => {
                                const { cx, cy, payload } = props;
                                if (cx == null || cy == null || !payload) return <g />;
                                const fill = payload.profit > 0
                                    ? 'var(--status-positive)'
                                    : payload.profit < 0
                                        ? 'var(--status-negative)'
                                        : 'var(--muted-foreground)';
                                return <circle cx={cx} cy={cy} r={4} fill={fill} />;
                            }}
                            activeDot={false}
                            isAnimationActive={false}
                        />
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
