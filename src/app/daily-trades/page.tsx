'use client';

import { useState, useEffect } from 'react';
import { useYearFilter } from '@/contexts/YearFilterContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Copy } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { US_MARKET_HOLIDAYS, isMarketHoliday } from '@/lib/holidays';
import { Skeleton } from '@/components/ui/skeleton';
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

export default function DailyTradesPage() {
    const { selectedYear } = useYearFilter();
    const [date, setDate] = useState<string>('');
    const [data, setData] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [availableDates, setAvailableDates] = useState<string[]>([]);
    const [isCalendarOpen, setIsCalendarOpen] = useState(false);
    const { toast } = useToast();

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
                } else {
                    setData([]);
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

    const generateTradesText = (userGroup: any) => {
        let text = ``;
        if (date) {
            const d = new Date(date);
            const dateStr = `${d.getFullYear().toString().slice(-2)}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            text += `交易日期 : ${dateStr}\n`;
            text += `----------------------------------------\n`;
        }
        
        const stockLines: string[] = [];
        const optionChunks: string[] = [];

        const formatOptionTrade = (trade: any) => {
            const transactionQty = trade.action_type === 'close' ? -trade.quantity : trade.quantity;
            const qtyStr = transactionQty > 0 ? `+${transactionQty}` : `${transactionQty}`;
            
            let expiryStr = '';
            if (trade.to_date) {
                const expiryDate = new Date(trade.to_date * 1000);
                const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                const monthName = months[expiryDate.getMonth()];
                const dayStr = String(expiryDate.getDate()).padStart(2, '0');
                const yearStr = String(expiryDate.getFullYear()).slice(2);
                expiryStr = ` ${monthName}${dayStr}'${yearStr}`;
            }

            const symbolStr = `${trade.symbol}${expiryStr} ${trade.strike_price}${trade.option_type === 'CALL' ? 'C' : 'P'}`;
            return `${qtyStr}口 ${symbolStr}`;
        };

        // Identify rolls
        const optionOpens = userGroup.trades.filter((t: any) => t.asset_type === 'option' && t.action_type === 'open');
        const optionCloses = userGroup.trades.filter((t: any) => t.asset_type === 'option' && t.action_type === 'close');
        
        const matchedOpenIds = new Set();
        const matchedCloseIds = new Set();
        
        const openGroups: Record<string, any[]> = {};
        const closeGroups: Record<string, any[]> = {};
        
        optionOpens.forEach((t: any) => {
            const key = `${t.symbol}_${t.option_type}_${t.group_id || 'no_group'}`;
            if (!openGroups[key]) openGroups[key] = [];
            openGroups[key].push(t);
        });
        
        optionCloses.forEach((t: any) => {
            const key = `${t.symbol}_${t.option_type}_${t.group_id || 'no_group'}`;
            if (!closeGroups[key]) closeGroups[key] = [];
            closeGroups[key].push(t);
        });

        const rollGroups: { closed: any[], opened: any[] }[] = [];

        Object.keys(closeGroups).forEach(key => {
            if (openGroups[key]) {
                let matchedC = closeGroups[key].filter(t => !matchedCloseIds.has(t.id));
                let matchedO = openGroups[key].filter(t => !matchedOpenIds.has(t.id));
                if (matchedC.length === 0 || matchedO.length === 0) return;
                
                const sumC = matchedC.reduce((s, t) => s + t.quantity, 0);
                const sumO = matchedO.reduce((s, t) => s + t.quantity, 0);
                
                if (sumC === sumO && sumC !== 0) {
                    matchedC.forEach(t => matchedCloseIds.add(t.id));
                    matchedO.forEach(t => matchedOpenIds.add(t.id));
                    rollGroups.push({ closed: matchedC, opened: matchedO });
                } else {
                    // Try 1-to-1 exact match
                    matchedC.forEach(c => {
                        if (matchedCloseIds.has(c.id)) return;
                        const oIndex = matchedO.findIndex(o => !matchedOpenIds.has(o.id) && o.quantity === c.quantity);
                        if (oIndex !== -1) {
                            const o = matchedO[oIndex];
                            matchedCloseIds.add(c.id);
                            matchedOpenIds.add(o.id);
                            rollGroups.push({ closed: [c], opened: [o] });
                        }
                    });
                }
            }
        });

        // Format rolls
        rollGroups.forEach(rg => {
            const lines: string[] = [];
            
            let canCalc = true;
            let totalCostToClose = 0;
            rg.closed.forEach(c => {
                if (c.old_premium == null || c.profit == null) canCalc = false;
                totalCostToClose += (c.old_premium - c.profit);
            });
            let totalPremiumOpened = 0;
            rg.opened.forEach(o => {
                if (o.price == null) canCalc = false;
                totalPremiumOpened += o.price;
            });
            
            let daysDiffStr = '';
            if (rg.opened.length > 0 && rg.closed.length > 0) {
                const openToDate = rg.opened[0].to_date;
                const closeToDate = rg.closed[0].to_date;
                if (openToDate && closeToDate) {
                    const daysDiff = Math.round((openToDate - closeToDate) / 86400);
                    daysDiffStr = ` ${daysDiff} 天，`;
                }
            }

            if (canCalc) {
                const rollProfit = totalPremiumOpened - totalCostToClose;
                const sign = rollProfit > 0 ? '+' : '';
                if (daysDiffStr) {
                    lines.push(`展期${daysDiffStr}盈虧 ${sign}${rollProfit.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}`);
                } else {
                    lines.push(`展期盈虧: ${sign}${rollProfit.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}`);
                }
            } else {
                if (daysDiffStr) {
                    lines.push(`展期${daysDiffStr.slice(0, -1)}`);
                } else {
                    lines.push(`展期`);
                }
            }

            rg.opened.forEach(o => lines.push(formatOptionTrade(o)));
            rg.closed.forEach(c => lines.push(formatOptionTrade(c)));
            
            optionChunks.push(lines.join('\n'));
        });

        const standaloneOptions: string[] = [];
        userGroup.trades.forEach((trade: any) => {
            if (trade.asset_type === 'stock') {
                const transactionQty = trade.action_type === 'close' ? -trade.quantity : trade.quantity;
                const action = transactionQty > 0 ? '買' : '賣';
                const qtyStr = formatNumber(Math.abs(transactionQty));
                
                const priceNum = new Intl.NumberFormat('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                }).format(trade.price || 0);
                
                stockLines.push(`${action} ${trade.symbol} ${qtyStr} 股 (均價 ${priceNum})`);
            } else if (trade.asset_type === 'option') {
                if (trade.action_type === 'open' && matchedOpenIds.has(trade.id)) return;
                if (trade.action_type === 'close' && matchedCloseIds.has(trade.id)) return;
                standaloneOptions.push(formatOptionTrade(trade));
            }
        });

        if (standaloneOptions.length > 0) {
            optionChunks.push(standaloneOptions.join('\n'));
        }
        
        const sections: string[] = [];
        if (stockLines.length > 0) sections.push(stockLines.join('\n'));
        if (optionChunks.length > 0) sections.push(optionChunks.join('\n\n'));
        
        if (sections.length > 0) {
            text += sections.join('\n----------------------------------------\n');
        }
        return text;
    };

    return (
        <div className="container mx-auto py-10 max-w-[1400px]">
            <div className="mb-8 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <h1 className="text-3xl font-bold">當日交易</h1>
                
                <div className="flex items-center gap-2 bg-white/50 dark:bg-black/50 p-1 rounded-md border shadow-sm">
                    <Button variant="ghost" size="icon" onClick={() => changeDate(-1)}>
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Popover modal={true} open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                        <PopoverTrigger asChild>
                            <Button
                                variant={"ghost"}
                                className={cn(
                                    "w-[160px] justify-between text-center font-normal px-2 hover:bg-transparent",
                                    !date && "text-muted-foreground"
                                )}
                            >
                                {date ? (
                                    <span>
                                        {date.replace(/-/g, '/')} ({['日', '一', '二', '三', '四', '五', '六'][new Date(date).getDay()]})
                                    </span>
                                ) : <span>選擇日期</span>}
                                <CalendarIcon className="h-4 w-4 opacity-50" />
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
                    <Button variant="ghost" size="icon" onClick={() => changeDate(1)}>
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {[1, 2, 3].map(i => (
                        <Card key={i} className="overflow-hidden">
                            <CardHeader className="bg-muted/50 pb-4 border-b">
                                <div className="flex items-center gap-3">
                                    <Skeleton className="h-10 w-10 rounded-full" />
                                    <Skeleton className="h-6 w-32" />
                                </div>
                            </CardHeader>
                            <CardContent className="p-0">
                                <div className="p-4 space-y-3">
                                    <Skeleton className="h-12 w-full" />
                                    <Skeleton className="h-12 w-full" />
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            ) : data.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground bg-muted/20 rounded-lg border border-dashed">
                    <CalendarIcon className="h-12 w-12 mb-4 opacity-20" />
                    <p className="text-lg">這個日期沒有任何交易記錄</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {data.map((userGroup: any) => {
                        const reportText = generateTradesText(userGroup);
                        const userName = userGroup.user.name || userGroup.user.user_id;
                        
                        return (
                            <div key={userGroup.user.id} className="bg-white rounded-lg border shadow-sm p-4 flex flex-col">
                                <div className="flex items-center justify-between mb-2">
                                    <h3 className="font-semibold text-sm">{userName} 當日交易</h3>
                                    <div className="flex gap-0.5 items-center">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-6 w-6"
                                            onClick={() => {
                                                const fullText = `${userName} 當日交易\n${reportText}`;
                                                navigator.clipboard.writeText(fullText);
                                                toast({ title: "已複製", description: `${userName} 的當日交易已複製` });
                                            }}
                                        >
                                            <Copy className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                </div>
                                <pre className="font-mono text-sm whitespace-pre-wrap flex-1 leading-relaxed">
                                    {reportText.split('\n').map((line, i, arr) => {
                                        const isRollHighlight = line.startsWith('展期');
                                        return (
                                            <span key={i} className={isRollHighlight ? 'bg-amber-100/80 px-1 rounded text-foreground font-medium' : ''}>
                                                {line}{i < arr.length - 1 ? '\n' : ''}
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
