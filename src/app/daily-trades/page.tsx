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
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground bg-muted/20 rounded-lg border border-dashed">
                    <CalendarIcon className="h-12 w-12 mb-4 opacity-20" />
                    <p className="text-lg">這個日期沒有任何交易記錄</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {filteredData.map((userGroup: any) => {
                        const reportText = generateTradesText(userGroup);
                        const userName = userGroup.user.name || userGroup.user.user_id;

                        // Sum every 盈虧 amount the report renders → day's total realized profit.
                        // Catches stock close PnLs, option close/expire/assigned PnLs, and roll PnLs.
                        let dayProfit = 0;
                        for (const m of reportText.matchAll(/盈虧\s*([+-]?[\d,]+(?:\.\d+)?)/g)) {
                            dayProfit += parseFloat(m[1].replace(/,/g, ''));
                        }
                        const profitStr = `${dayProfit > 0 ? '+' : ''}${dayProfit.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}`;
                        const profitColor = dayProfit > 0 ? 'text-status-positive' : dayProfit < 0 ? 'text-status-negative' : 'text-muted-foreground';

                        return (
                            <div key={userGroup.user.id} className="bg-card rounded-lg border shadow-sm p-4 flex flex-col">
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
                                        >
                                            <Copy className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                </div>
                                <pre className="font-mono text-sm whitespace-pre-wrap flex-1 leading-relaxed">
                                    {reportText.split('\n').map((line, i, arr) => {
                                        const isRollHighlight = line.includes('展期') || line.startsWith('開新倉') || line.startsWith('平倉') || line.startsWith('到期');
                                        
                                        const parts = line.split(/((?:盈虧|損益|權利金) [+-]?[\d,]+(?:\.\d+)?|被突破 [\d,]+(?:\.\d+)?|被行權)/);
                                        const renderedParts = parts.map((part, pIndex) => {
                                            if (part.startsWith('盈虧 ') || part.startsWith('損益 ') || part.startsWith('權利金 ')) {
                                                const prefix = part.startsWith('盈虧 ') ? '盈虧 ' : part.startsWith('損益 ') ? '損益 ' : '權利金 ';
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
                </div>
            )}
        </div>
    );
}
