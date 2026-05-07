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

export default function DailyTradesPage() {
    const { selectedYear } = useYearFilter();
    const [date, setDate] = useState<string>('');
    const [data, setData] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const { toast } = useToast();

    // Initialize date to the last valid trading day
    useEffect(() => {
        let current = new Date();
        // Keep going back until we find a non-weekend, non-holiday day
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
    }, []);

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

    const generateTradesText = (userGroup: any) => {
        let text = ``;
        if (date) {
            const d = new Date(date);
            const dateStr = `${d.getFullYear().toString().slice(-2)}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            text += `交易日期 : ${dateStr}\n`;
            text += `----------------------------------------\n`;
        }
        
        userGroup.trades.forEach((trade: any) => {
            const isBuy = trade.quantity > 0;
            const displayQty = Math.abs(trade.quantity);
            let actionText = '';
            
            if (trade.asset_type === 'stock') {
                actionText = trade.action_type === 'open' ? '買入' : '賣出';
            } else {
                if (trade.action_type === 'open') {
                    actionText = isBuy ? '買權 (BTO)' : '賣權 (STO)';
                } else {
                    actionText = isBuy ? '平倉 (STC)' : '平倉 (BTC)';
                }
            }
            
            const symbolStr = trade.asset_type === 'stock' 
                ? trade.symbol 
                : `${trade.symbol} ${trade.strike_price}${trade.option_type === 'CALL' ? 'C' : 'P'}`;
                
            const unit = trade.asset_type === 'stock' ? '股' : '口';
            
            text += `${actionText} ${symbolStr} ${displayQty}${unit}\n`;
            
            if (trade.action_type === 'open' || trade.asset_type === 'stock') {
                text += `成交價 : ${formatMoney(trade.price)}\n`;
            } else {
                const profitStr = trade.profit >= 0 ? `+${formatMoney(trade.profit)}` : formatMoney(trade.profit);
                text += `平倉損益 : ${profitStr}\n`;
            }
            text += `----------------------------------------\n`;
        });
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
                    <div className="relative">
                        <Input 
                            type="date" 
                            value={date} 
                            onChange={handleDateChange}
                            className="w-[140px] border-none bg-transparent shadow-none focus-visible:ring-0 cursor-pointer"
                        />
                    </div>
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
                                        const isHighlighted = line.includes('(STO)') || line.includes('(BTO)') || line.includes('(BTC)') || line.includes('(STC)') || line.startsWith('買入') || line.startsWith('賣出');
                                        return (
                                            <span key={i} className={isHighlighted ? "bg-yellow-100 rounded px-1 -ml-1" : ""}>
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
