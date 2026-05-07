'use client';

import { useState, useEffect } from 'react';
import { useYearFilter } from '@/contexts/YearFilterContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react';
import { US_MARKET_HOLIDAYS, isMarketHoliday } from '@/lib/holidays';
import { Skeleton } from '@/components/ui/skeleton';

export default function DailyTradesPage() {
    const { selectedYear } = useYearFilter();
    const [date, setDate] = useState<string>('');
    const [data, setData] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

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
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {data.map((userGroup: any) => (
                        <Card key={userGroup.user.id} className="overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                            <CardHeader className="bg-muted/30 pb-4 border-b">
                                <div className="flex items-center gap-3">
                                    <Avatar className="h-10 w-10 border shadow-sm">
                                        <AvatarImage src={userGroup.user.avatar_url || ''} />
                                        <AvatarFallback>{(userGroup.user.name || userGroup.user.user_id || '?').substring(0, 2).toUpperCase()}</AvatarFallback>
                                    </Avatar>
                                    <div>
                                        <CardTitle className="text-lg">{userGroup.user.name || userGroup.user.user_id}</CardTitle>
                                        <div className="text-xs text-muted-foreground mt-1">
                                            {userGroup.user.ib_account || '無 IB 帳號'}
                                        </div>
                                    </div>
                                    <Badge variant="outline" className="ml-auto bg-background">
                                        {userGroup.trades.length} 筆
                                    </Badge>
                                </div>
                            </CardHeader>
                            <CardContent className="p-0">
                                <div className="divide-y">
                                    {userGroup.trades.map((trade: any) => {
                                        const isBuy = trade.quantity > 0;
                                        const displayQty = Math.abs(trade.quantity);
                                        
                                        // Determine text color based on action and type
                                        let actionText = '';
                                        let actionColor = '';
                                        
                                        if (trade.asset_type === 'stock') {
                                            if (trade.action_type === 'open') {
                                                actionText = '買入';
                                                actionColor = 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20';
                                            } else {
                                                actionText = '賣出';
                                                actionColor = 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20';
                                            }
                                        } else {
                                            // Options
                                            if (trade.action_type === 'open') {
                                                if (isBuy) {
                                                    actionText = '買權 (BTO)';
                                                    actionColor = 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20';
                                                } else {
                                                    actionText = '賣權 (STO)';
                                                    actionColor = 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20';
                                                }
                                            } else {
                                                if (isBuy) {
                                                    actionText = '平倉 (STC)';
                                                    actionColor = 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20';
                                                } else {
                                                    actionText = '平倉 (BTC)';
                                                    actionColor = 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20';
                                                }
                                            }
                                        }

                                        return (
                                            <div key={`${trade.asset_type}-${trade.action_type}-${trade.id}`} className="flex items-center justify-between p-4 hover:bg-muted/10 transition-colors">
                                                <div className="flex items-center gap-3">
                                                    <div className={`px-2 py-1 rounded text-xs font-bold whitespace-nowrap ${actionColor}`}>
                                                        {actionText}
                                                    </div>
                                                    <div>
                                                        <div className="font-semibold flex items-center gap-1">
                                                            {trade.symbol}
                                                            {trade.asset_type === 'option' && (
                                                                <span className="text-xs font-normal text-muted-foreground ml-1">
                                                                    {trade.strike_price}{trade.option_type === 'CALL' ? 'C' : 'P'}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="text-xs text-muted-foreground">
                                                            {trade.asset_type === 'stock' ? '股票' : '期權'} • {displayQty} {trade.asset_type === 'stock' ? '股' : '口'}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    {trade.action_type === 'open' || trade.asset_type === 'stock' ? (
                                                        <div className="font-medium">
                                                            {formatMoney(trade.price)}
                                                        </div>
                                                    ) : (
                                                        <div className={`font-medium ${trade.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                            {trade.profit >= 0 ? '+' : ''}{formatMoney(trade.profit)}
                                                        </div>
                                                    )}
                                                    <div className="text-xs text-muted-foreground">
                                                        {trade.action_type === 'open' ? '成交價' : (trade.asset_type === 'option' ? '平倉損益' : '平倉價')}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}
