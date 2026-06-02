'use client';

import { useState, useEffect, useRef } from 'react';
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
import { useAdminSettings } from '@/contexts/AdminSettingsContext';

// Standard finance convention for trading days per year, used to convert
// the annual 權利金目標 percent into a daily-profit target for the chart.
const TRADING_DAYS_PER_YEAR = 252;

export default function DailyTradesPage() {
    const { selectedYear } = useYearFilter();
    const { settings } = useAdminSettings();
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
    // historyEndDate drives the 30-day chart's right edge. It tracks `date`
    // EXCEPT when the user clicked a point on the chart itself — in that case
    // we only want the left card to swap; the chart's range should stay put
    // so the user can keep scrubbing without losing their place.
    const [historyEndDate, setHistoryEndDate] = useState<string>('');
    const chartClickRef = useRef(false);
    // Suppress the skeleton loader on chart-driven date changes — swapping
    // cards mid-scrub should feel instant, not a fresh page load.
    const silentDateRef = useRef(false);
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

        const silent = silentDateRef.current;
        silentDateRef.current = false;

        const fetchData = async () => {
            if (!silent) setLoading(true);
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
                if (!silent) setLoading(false);
            }
        };
        fetchData();
    }, [date, selectedYear]);

    // Sync historyEndDate from `date` whenever `date` changes, EXCEPT when
    // the change came from a chart-dot click. That keeps the chart pinned
    // while the left card swaps to the picked day.
    useEffect(() => {
        if (!date) return;
        if (chartClickRef.current) {
            chartClickRef.current = false;
            return;
        }
        setHistoryEndDate(date);
    }, [date]);

    // Single-account mode chart: 30-day option-收益 history for the
    // selected user. Skip the fetch in 'all' mode — chart is hidden.
    useEffect(() => {
        if (selectedAccount === 'all' || !historyEndDate) {
            setHistoryData([]);
            return;
        }
        let cancelled = false;
        const fetchHistory = async () => {
            setHistoryLoading(true);
            try {
                const url = `/api/daily-trades/history?user_id=${encodeURIComponent(selectedAccount)}&endDate=${historyEndDate}&days=30&year=${selectedYear}`;
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
    }, [selectedAccount, historyEndDate, selectedYear]);

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


    // Sort cards alphabetically by user_id so the grid scans predictably
    // regardless of the order the API returns groups in.
    const filteredData = (selectedAccount === 'all' ? data : data.filter((group: any) => group.user?.user_id === selectedAccount))
        .slice()
        .sort((a: any, b: any) => {
            const ka = (a.user?.user_id || a.user?.name || '').toLowerCase();
            const kb = (b.user?.user_id || b.user?.name || '').toLowerCase();
            return ka.localeCompare(kb);
        });

    // Daily 權利金目標 reference line. Cost basis mirrors the badge formula on
    // the options summary page: prefer the user's initial_cost; fall back to
    // net_deposit when they started with no initial capital. Annual target is
    // cost × premiumTargetPercent / 100; divide by 252 trading days to land
    // the per-day expected profit that the dashed line sits at.
    const selectedAccountInfo = selectedAccount !== 'all'
        ? allAccounts.find((a: any) => (a.user_id || a.email) === selectedAccount)
        : null;
    const costBasisForTarget = selectedAccountInfo
        ? ((selectedAccountInfo.initial_cost && selectedAccountInfo.initial_cost > 0)
            ? selectedAccountInfo.initial_cost
            : (selectedAccountInfo.net_deposit || 0))
        : 0;
    const dailyTarget = costBasisForTarget > 0
        ? (costBasisForTarget * (settings.premiumTargetPercent / 100)) / TRADING_DAYS_PER_YEAR
        : 0;

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
                    {(() => {
                        // Alphabetically-sorted list of available accounts, used both
                        // by the dropdown and the prev/next cycler. We compute it once
                        // here so the IDs the arrows iterate match what the dropdown
                        // shows.
                        const sortedAccountIds = [...allAccounts]
                            .sort((a: any, b: any) => (a.user_id || '').localeCompare(b.user_id || ''))
                            .map((a: any) => a.user_id)
                            .filter(Boolean) as string[];
                        const cycleAccount = (offset: number) => {
                            if (sortedAccountIds.length === 0) return;
                            const idx = sortedAccountIds.indexOf(selectedAccount);
                            if (idx === -1) {
                                setSelectedAccount(sortedAccountIds[0]);
                                return;
                            }
                            // Wrap around so left at start jumps to end and vice versa.
                            const next = (idx + offset + sortedAccountIds.length) % sortedAccountIds.length;
                            setSelectedAccount(sortedAccountIds[next]);
                        };
                        const inSingleMode = selectedAccount !== 'all';
                        return (
                            <div className="flex items-center h-10 bg-card/50 dark:bg-black/50 rounded-md border shadow-sm">
                                {inSingleMode && (
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-full rounded-r-none"
                                        onClick={() => cycleAccount(-1)}
                                    >
                                        <ChevronLeft className="h-4 w-4" />
                                    </Button>
                                )}
                                <Select value={selectedAccount} onValueChange={setSelectedAccount}>
                                    <SelectTrigger className={cn(
                                        "w-[140px] h-full border-0 shadow-none bg-transparent focus:ring-0",
                                        inSingleMode
                                            ? "justify-center rounded-none border-x border-border/50 [&>svg]:hidden"
                                            : "justify-between"
                                    )}>
                                        <SelectValue placeholder="全部帳戶" />
                                    </SelectTrigger>
                                    <SelectContent className="max-h-none">
                                        <SelectItem value="all">全部帳戶</SelectItem>
                                        {sortedAccountIds.map(uid => (
                                            <SelectItem key={uid} value={uid}>
                                                {uid}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {inSingleMode && (
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-full rounded-l-none"
                                        onClick={() => cycleAccount(1)}
                                    >
                                        <ChevronRight className="h-4 w-4" />
                                    </Button>
                                )}
                            </div>
                        );
                    })()}

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
                            currentDate={date}
                            dailyTarget={dailyTarget}
                            onSelectDate={(d) => {
                                // Flag the upcoming setDate as chart-origin so the
                                // sync effect skips updating historyEndDate, and the
                                // fetch effect skips the skeleton loader.
                                chartClickRef.current = true;
                                silentDateRef.current = true;
                                setDate(d);
                            }}
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
                                className="bg-card rounded-lg border shadow-sm p-4 flex flex-col"
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
                            currentDate={date}
                            dailyTarget={dailyTarget}
                            onSelectDate={(d) => {
                                // Flag the upcoming setDate as chart-origin so the
                                // sync effect skips updating historyEndDate, and the
                                // fetch effect skips the skeleton loader.
                                chartClickRef.current = true;
                                silentDateRef.current = true;
                                setDate(d);
                            }}
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
    onSelectDate?: (date: string) => void;
    /** YYYY-MM-DD currently shown in the left card; chart draws a persistent
     *  vertical reference line at that date so the user sees which point the
     *  card matches without hovering. */
    currentDate?: string;
    /** Expected daily profit (in raw $) derived from the 權利金目標 setting.
     *  When > 0 the chart overlays a dashed horizontal reference line at
     *  this value so the user sees at a glance which days hit / missed
     *  target. Drawn in the same y-axis (signed-sqrt) projection as the
     *  data line, so it sits on the right visual band. */
    dailyTarget?: number;
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

function DailyProfitHistoryChart({ data, loading, onSelectDate, currentDate, dailyTarget }: DailyProfitHistoryChartProps) {
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
    const totalProfit = data.reduce((s, d) => s + d.profit, 0);
    const totalStr = `${totalProfit > 0 ? '+' : ''}${Math.round(totalProfit).toLocaleString('en-US')}`;
    const totalColor = totalProfit > 0 ? 'text-status-positive' : totalProfit < 0 ? 'text-status-negative' : 'text-muted-foreground';

    // Pick raw $ tick magnitudes that bracket the data, then project into
    // signed-sqrt space so the axis labels still read in dollars.
    const CANDIDATE_MAGS = [1000, 3000, 10000, 30000];
    const dataMaxAbs = Math.max(1, ...data.map(d => Math.abs(d.profit)));
    const usefulMags = CANDIDATE_MAGS.filter(m => m <= dataMaxAbs * 1.5);
    const tickPoolRaw = usefulMags.length > 0
        ? [...usefulMags.map(m => -m).reverse(), 0, ...usefulMags]
        : [-1000, 0, 1000];
    const tickPoolSqrt = tickPoolRaw.map(sgnSqrt);
    // Pad the domain ~20% past the outermost tick so the highest/lowest
    // points don't kiss the plot border. Domain is in sqrt-space; padding
    // scales to the same axis so both ends get equal visual breathing room.
    const yPad = Math.max(Math.abs(tickPoolSqrt[0]), Math.abs(tickPoolSqrt[tickPoolSqrt.length - 1])) * 0.2;
    const yDomain: [number, number] = [
        tickPoolSqrt[0] - yPad,
        tickPoolSqrt[tickPoolSqrt.length - 1] + yPad,
    ];

    // Pin the 權利金目標 onto the y-axis as an extra tick so the dashed
    // target line carries its own labeled value instead of leaving the
    // user to eyeball it. Avoid stacking on top of a magnitude tick by
    // dropping the closest magnitude when they'd collide visually.
    const targetRaw = dailyTarget != null && dailyTarget > 0 ? Math.round(dailyTarget) : null;
    const TICK_COLLISION_SQRT = 4; // ≈ 16 raw $; below this they overlap visually
    const finalTickPoolSqrt = targetRaw != null
        ? [
            ...tickPoolSqrt.filter(t => Math.abs(t - sgnSqrt(targetRaw)) > TICK_COLLISION_SQRT),
            sgnSqrt(targetRaw),
          ].sort((a, b) => a - b)
        : tickPoolSqrt;

    // Info panel falls back to whichever day the left card is showing
    // (currentDate), so the readout always agrees with the card. If that
    // date isn't in the chart's window for some reason, fall back to the
    // most recent point.
    const lastPoint = data[data.length - 1];
    const selectedPoint = currentDate ? data.find(d => d.date === currentDate) : undefined;
    const panelPoint = hoveredPoint ?? selectedPoint ?? lastPoint;
    const panelProfitStr = panelPoint
        ? `${panelPoint.profit > 0 ? '+' : ''}${Math.round(panelPoint.profit).toLocaleString('en-US')}`
        : '';
    const panelProfitColor = panelPoint
        ? (panelPoint.profit > 0 ? 'text-status-positive' : panelPoint.profit < 0 ? 'text-status-negative' : 'text-muted-foreground')
        : 'text-muted-foreground';

    return (
        <div className="bg-card rounded-lg border shadow-sm p-4 pb-2 flex flex-col min-h-[360px]">
            <div className="relative mb-2 min-h-[20px] flex items-center">
                {/* Hover readout sits flush-left of the header row as a single line.
                    Shows the hovered point when active, otherwise defaults to the
                    most recent day so the row never goes empty. */}
                {panelPoint && (
                    <div className="text-sm whitespace-nowrap ml-[50px]">
                        {/* Trim the YYYY- prefix so the date is just MM-DD,
                            matching the chart's x-axis labels. */}
                        <span className="font-medium">{panelPoint.date.substring(5)}</span>
                        <span className="text-muted-foreground"> · 收益 </span>
                        <span className={cn("font-semibold", panelProfitColor)}>{panelProfitStr}</span>
                        {dailyTarget != null && dailyTarget > 0 && (
                            <>
                                <span className="text-muted-foreground"> · 目標 </span>
                                <span className="font-semibold text-muted-foreground">
                                    +{Math.round(dailyTarget).toLocaleString('en-US')}
                                </span>
                            </>
                        )}
                    </div>
                )}
                {/* Title floats centered above the chart so it sits over the plot
                    area rather than crowding the y-axis side of the card. */}
                <div className="absolute left-1/2 -translate-x-1/2 text-sm font-semibold whitespace-nowrap">
                    過去 30 個交易日<span className="text-muted-foreground"> · 收益合計 </span>
                    <span className={totalColor}>{totalStr}</span>
                    {dailyTarget != null && dailyTarget > 0 && (
                        <>
                            <span className="text-muted-foreground"> · 目標 </span>
                            <span className="text-muted-foreground">
                                +{Math.round(dailyTarget * data.length).toLocaleString('en-US')}
                            </span>
                        </>
                    )}
                </div>
            </div>
            <div className="relative flex-1 min-h-[300px] [&_*:focus]:outline-none [&_*:focus-visible]:outline-none">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                        data={chartData}
                        margin={{ top: 8, right: 16, left: 0, bottom: 4 }}
                        onClick={(state: { activeTooltipIndex?: number; activePayload?: { payload?: { date: string } }[] }) => {
                            // Snap the page's selected date to the clicked point so the
                            // card on the left jumps to that day's trades. Prefer the
                            // payload route (full row), fall back to the index into
                            // chartData — Recharts populates one or the other depending
                            // on whether the click landed exactly on a dot vs the line.
                            const fromPayload = state?.activePayload?.[0]?.payload?.date;
                            const idx = state?.activeTooltipIndex;
                            const fromIndex = typeof idx === 'number' && idx >= 0 && idx < chartData.length
                                ? chartData[idx].date
                                : undefined;
                            const d = fromPayload ?? fromIndex;
                            if (d) onSelectDate?.(d);
                        }}
                        style={{ cursor: onSelectDate ? 'pointer' : 'default' }}
                    >
                        {/* Only vertical (per-date) grid lines remain — horizontal
                            y-grid lines doubled up with the zero reference and
                            cluttered the canvas. The ReferenceLine at 0 below
                            still draws the single horizontal anchor we need. */}
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                        <XAxis
                            dataKey="label"
                            tick={{ fontSize: 11, fill: 'var(--foreground)' }}
                            interval="preserveStartEnd"
                            minTickGap={20}
                        />
                        <YAxis
                            tick={{ fontSize: 11, fill: 'var(--foreground)' }}
                            ticks={finalTickPoolSqrt}
                            domain={yDomain}
                            tickMargin={4}
                            tickFormatter={(v) => {
                                // Invert the signed-sqrt and round to the nearest 10
                                // so projected ticks always read as clean $ values.
                                const raw = Math.sign(v) * v * v;
                                // The 權利金目標 tick gets its exact value so users
                                // see the precise number (e.g. 201) instead of a
                                // rounded-to-10 approximation (200).
                                if (targetRaw != null && Math.abs(raw - targetRaw) < 1) {
                                    return targetRaw.toLocaleString('en-US');
                                }
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
                        {/* 權利金目標 reference line — daily-target ÷ 252 trading
                            days, projected into the same signed-sqrt y-axis as
                            the data line. Muted-foreground stroke so it reads
                            as a passive reference. The target value is shown
                            in the header readout, so no on-chart label. */}
                        {dailyTarget != null && dailyTarget > 0 && (
                            <ReferenceLine
                                y={sgnSqrt(dailyTarget)}
                                stroke="var(--muted-foreground)"
                                strokeDasharray="6 4"
                                strokeWidth={1.5}
                                strokeOpacity={0.7}
                            />
                        )}
                        {/* Persistent crosshair at the currently-shown date so
                            users see at a glance which point the left card matches.
                            Only render when that date is actually in the chart's
                            window — otherwise Recharts draws it at the edge. */}
                        {currentDate && data.some(d => d.date === currentDate) && (
                            <ReferenceLine
                                x={currentDate.substring(5)}
                                stroke="var(--chart-orange)"
                                strokeWidth={2}
                                strokeDasharray="3 3"
                            />
                        )}
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
                                return (
                                    <circle
                                        cx={cx}
                                        cy={cy}
                                        r={4}
                                        fill={fill}
                                        style={{ cursor: onSelectDate ? 'pointer' : 'default' }}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (onSelectDate) onSelectDate(payload.date);
                                        }}
                                    />
                                );
                            }}
                            activeDot={(props: { cx?: number; cy?: number; payload?: { profit: number; date: string } }) => {
                                // Subtle hover state: same color fill, grown from r=4
                                // to r=6, with a thin foreground ring as a click hint.
                                // Click handler lives on the SVG circle itself —
                                // LineChart's own onClick proved flaky in this layout.
                                const { cx, cy, payload } = props;
                                if (cx == null || cy == null || !payload) return <g />;
                                const fill = payload.profit > 0
                                    ? 'var(--status-positive)'
                                    : payload.profit < 0
                                        ? 'var(--status-negative)'
                                        : 'var(--muted-foreground)';
                                return (
                                    <circle
                                        cx={cx}
                                        cy={cy}
                                        r={6}
                                        fill={fill}
                                        stroke="var(--foreground)"
                                        strokeWidth={1.5}
                                        style={{ cursor: onSelectDate ? 'pointer' : 'default' }}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (onSelectDate) onSelectDate(payload.date);
                                        }}
                                    />
                                );
                            }}
                            isAnimationActive={false}
                        />
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
