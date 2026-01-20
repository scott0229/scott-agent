'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Loader2, ArrowLeft, Star, Plus, Pencil, Trash2 } from "lucide-react";
import { NetEquityChart } from '@/components/NetEquityChart';
import { useYearFilter } from '@/contexts/YearFilterContext';
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { useToast } from "@/hooks/use-toast";



interface BenchmarkRecord {
    id: number;
    date: number;
    net_equity: number;
    daily_deposit: number;
    daily_return: number;
    nav_ratio: number;
    running_peak: number;
    drawdown: number;
    is_new_high: boolean;
    close_price: number;
    shares: number;
}

export default function BenchmarkDetailPage() {
    const params = useParams();
    const router = useRouter();
    const { toast } = useToast();
    const [records, setRecords] = useState<BenchmarkRecord[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [userName, setUserName] = useState<string>('');
    const [initialCost, setInitialCost] = useState<number>(0);
    const [basePrice, setBasePrice] = useState<number>(0);

    const [addPriceOpen, setAddPriceOpen] = useState(false);
    const [newPriceDate, setNewPriceDate] = useState('');
    const [newPriceValue, setNewPriceValue] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [deletePricesOpen, setDeletePricesOpen] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    const [selectedMonth, setSelectedMonth] = useState<string>('all');

    const { selectedYear } = useYearFilter();

    // Safe parsing
    const userId = typeof params.userId === 'string' ? params.userId : '';
    const symbol = typeof params.symbol === 'string' ? params.symbol : '';

    const handleAddPrice = async () => {
        if (!newPriceDate || !newPriceValue) return;
        setSubmitting(true);
        try {
            const dateObj = new Date(newPriceDate);
            const utcTimestamp = Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate()) / 1000;

            const res = await fetch('/api/market-data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    symbol,
                    date: utcTimestamp,
                    price: parseFloat(newPriceValue)
                })
            });

            if (res.ok) {

                setAddPriceOpen(false);
                setNewPriceDate('');
                setNewPriceValue('');
                fetchData(); // Refresh data
            } else {
                throw new Error("Failed to save");
            }
        } catch (e) {
            toast({ variant: "destructive", title: "失敗", description: "無法新增紀錄" });
        } finally {
            setSubmitting(false);
        }
    };






    const handleDeletePrices = async () => {
        setIsDeleting(true);
        try {
            const res = await fetch(`/api/market-data?mode=all&symbol=${symbol}`, {
                method: 'DELETE',
            });

            if (res.ok) {

                setDeletePricesOpen(false);
                fetchData(); // Refresh data
            } else {
                throw new Error("Failed to delete market data");
            }
        } catch (e) {
            toast({ variant: "destructive", title: "刪除失敗", description: "無法刪除資料" });
        } finally {
            setIsDeleting(false);
        }
    };

    const filteredRecords = records.filter(record => {
        if (selectedMonth === 'all') return true;
        const recordDate = new Date(record.date * 1000);
        return (recordDate.getMonth() + 1).toString() === selectedMonth;
    });

    const todayStr = new Date().toISOString().split('T')[0];

    useEffect(() => {
        if (userId && symbol) {
            fetchData();
        }
    }, [userId, symbol, selectedYear]);

    const fetchData = async () => {
        try {
            // Fetch User Data for Header
            const userRes = await fetch(`/api/users/${userId}`);
            if (userRes.ok) {
                const userData = await userRes.json();
                if (userData.user) {
                    setUserName(userData.user.user_id || userData.user.email);
                    setInitialCost(userData.user.initial_cost || 10000);
                }
            }

            // Fetch Benchmark Data
            const yearParam = selectedYear === 'All' ? '' : `&year=${selectedYear}`;
            const res = await fetch(`/api/benchmark?userId=${userId}&symbol=${symbol}${yearParam}`);
            const data = await res.json();

            if (data.success) {
                setRecords(data.data);
                // Update Initial Cost from meta if provided
                if (data.meta) {
                    if (data.meta.initialCost) setInitialCost(data.meta.initialCost);
                    if (data.meta.basePrice) setBasePrice(data.meta.basePrice);
                }
            }
        } catch (error) {
            console.error('Error:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const formatDate = (timestamp: number) => {
        const date = new Date(timestamp * 1000);
        return `${String(date.getFullYear()).slice(2)}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    };

    const formatMoney = (val: number) => {
        return new Intl.NumberFormat('en-US').format(Math.round(val));
    };

    const formatPercent = (val: number) => {
        // nav_ratio in DB is like 1.25. 
        // User screenshot shows "103.54%" for NAV Ratio (淨值率).
        // If 1.0 is the base, then 100% makes sense.
        // If daily_return, it's 0.01 -> 1.00%.
        return `${(val * 100).toFixed(2)}%`;
    };

    if (isLoading) {
        return (
            <div className="flex h-screen items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    // Prepare chart data - just map records
    // NetEquityChart expects: { date: number, net_equity: number, nav_ratio?: number }
    // We want to show the Benchmark Equity Curve.
    const chartData = [...records].reverse(); // API returns newest first, Chart wants oldest first?
    // Let's check NetEquityChart.
    // In NetEquityPage: `data={user.equity_history}`. Check `api/net-equity`... `chartData` is pushed in chronological order (oldest first).
    // The API `benchmark` returns `benchmarkData.reverse()` (newest first).
    // So for Chart, we need to reverse it back to chronological (Oldest -> Newest).

    return (
        <div className="container mx-auto py-8">
            <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => router.push('/net-equity')}>
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <h1 className="text-3xl font-bold">
                        {symbol} 對照績效 - {userName}
                    </h1>
                </div>
                <div className="flex items-center gap-2">
                    <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                        <SelectTrigger className="w-[120px]">
                            <SelectValue placeholder="月份" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">全部月份</SelectItem>
                            {Array.from({ length: 12 }, (_, i) => i + 1).map(month => (
                                <SelectItem key={month} value={month.toString()}>{month}月</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    <Button
                        variant="outline"
                        className="gap-2 bg-[#F9F4EF] hover:bg-[#F0E6DD] text-[#4A3728] border-[#EAE0D5]"
                        onClick={() => setDeletePricesOpen(true)}
                    >
                        <Trash2 className="h-4 w-4" />
                        刪除股價記錄
                    </Button>
                    <Button
                        className="gap-2 bg-[#EAE0D5] hover:bg-[#DBC9BA] text-[#4A3728] border-none"
                        onClick={() => setAddPriceOpen(true)}
                    >
                        <Plus className="h-4 w-4" />
                        新增
                    </Button>
                </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
                {/* Header Info / Chart could go here if we wanted deeper analysis, but adhering to "looks like Net Equity Analysis" */}

                {/* Chart Section - Reusing NetEquityChart?
                    The user said "looks like Net Equity Analysis".
                    Net Equity Analysis Page has a TABLE. Net Equity Dashboard has a CHART.
                    OH, `NetEquityDetailPage` (the one with the table) DOES NOT have a chart at the top!
                    It just has the table.
                    Wait, let me double check `src/app/net-equity/[userId]/page.tsx`.
                    I reviewed it in step 211.
                    It has `Table`, `NewNetEquityDialog`, etc.
                    It DOES NOT have `<NetEquityChart />`.
                    So the "Net Equity Analysis" page is JUST THE TABLE (and title).

                    HOWEVER, in the DASHBOARD (`/net-equity` root), there are cards with charts.
                    The User said: "Content looks like Net Equity Analysis" (referring to the detail page probably).
                    So I should replicate the TABLE.
                 */}

                <Table>
                    <TableHeader>
                        <TableRow className="bg-secondary/50 hover:bg-secondary/50">
                            <TableHead className="w-[100px] text-center font-bold text-foreground">交易日</TableHead>
                            <TableHead className="text-center font-bold text-foreground">收盤價</TableHead>
                            <TableHead className="text-center font-bold text-foreground">股數</TableHead>
                            <TableHead className="text-center font-bold text-foreground">帳戶淨值</TableHead>
                            {/* Daily Deposit usually 0 for benchmark */}
                            <TableHead className="text-center font-bold text-foreground">當日入金</TableHead>
                            <TableHead className="text-center font-bold text-foreground">當日報酬率</TableHead>
                            <TableHead className="text-center font-bold text-foreground">淨值率</TableHead>
                            <TableHead className="text-center font-bold text-foreground">前高</TableHead>
                            <TableHead className="text-center font-bold text-foreground">回撤</TableHead>
                            <TableHead className="text-center font-bold text-foreground">新高記錄</TableHead>
                            <TableHead className="w-[100px]"></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredRecords.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={11} className="h-24 text-center text-muted-foreground">
                                    尚無記錄
                                </TableCell>
                            </TableRow>
                        )}
                        {filteredRecords.map((record) => (
                            <TableRow key={record.id} className="hover:bg-muted/50 group">
                                <TableCell className="text-center font-mono font-medium">
                                    {formatDate(record.date)}
                                </TableCell>
                                <TableCell className="text-center">
                                    <div className="flex justify-center">
                                        <Badge variant="secondary" className="bg-slate-100 text-slate-600 hover:bg-slate-100 border border-slate-200 font-normal text-sm px-2">
                                            {record.close_price ? record.close_price.toFixed(2) : "未知"}
                                        </Badge>
                                    </div>
                                </TableCell>
                                <TableCell className="text-center font-mono">
                                    {record.shares?.toFixed(2)}
                                </TableCell>
                                <TableCell className="text-center font-mono">
                                    {record.close_price ? formatMoney(record.net_equity) : '-'}
                                </TableCell>
                                <TableCell className="text-center font-mono">
                                    {record.daily_deposit !== 0 ? formatMoney(record.daily_deposit) : '0'}
                                </TableCell>
                                <TableCell className="text-center font-mono">
                                    {record.close_price ? formatPercent(record.daily_return) : '-'}
                                </TableCell>
                                <TableCell className="text-center font-mono">
                                    {record.close_price ? formatPercent(record.nav_ratio) : '-'}
                                </TableCell>
                                <TableCell className="text-center font-mono">
                                    {record.close_price ? formatPercent(record.running_peak) : '-'}
                                </TableCell>
                                <TableCell className="text-center font-mono">
                                    {record.close_price ? formatPercent(record.drawdown) : '-'}
                                </TableCell>
                                <TableCell className="text-center">
                                    {record.is_new_high && (
                                        <div className="flex justify-center">
                                            <Star className="h-4 w-4 fill-yellow-400 text-yellow-500" />
                                        </div>
                                    )}
                                </TableCell>
                                <TableCell className="text-center px-2">
                                    <div className="flex items-center justify-end gap-1">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-muted-foreground hover:bg-primary/20 hover:text-primary"
                                            onClick={() => {
                                                const date = new Date(record.date * 1000);
                                                const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                                                setNewPriceDate(dateStr);
                                                setNewPriceValue(record.close_price?.toFixed(2) || '');
                                                setAddPriceOpen(true);
                                            }}
                                        >
                                            <Pencil className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                        {/* Initial Cost Row */}
                        <TableRow className="bg-muted/30 hover:bg-muted/50">
                            <TableCell className="text-center font-mono font-medium">
                                {selectedYear && selectedYear !== 'All'
                                    ? `${(parseInt(selectedYear) - 1).toString().slice(2)}-12-31`
                                    : "初始"}
                            </TableCell>
                            <TableCell className="text-center">
                                <div className="flex justify-center">
                                    {basePrice > 0 ? (
                                        <Badge variant="secondary" className="bg-slate-100 text-slate-600 hover:bg-slate-100 border border-slate-200 font-normal text-sm px-2">
                                            {basePrice.toFixed(2)}
                                        </Badge>
                                    ) : '-'}
                                </div>
                            </TableCell>
                            <TableCell className="text-center font-mono">
                                {basePrice > 0 ? (initialCost / basePrice).toFixed(2) : '-'}
                            </TableCell>
                            <TableCell className="text-center font-mono">
                                {formatMoney(initialCost)}
                            </TableCell>
                            <TableCell colSpan={6}></TableCell>
                            <TableCell className="text-center px-2">
                                <div className="flex items-center justify-end gap-1">
                                    {selectedYear && selectedYear !== 'All' && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-muted-foreground hover:bg-primary/20 hover:text-primary"
                                            onClick={() => {
                                                const year = parseInt(selectedYear) - 1;
                                                const dateStr = `${year}-12-31`;
                                                setNewPriceDate(dateStr);
                                                setNewPriceValue(basePrice > 0 ? basePrice.toFixed(2) : '');
                                                setAddPriceOpen(true);
                                            }}
                                        >
                                            <Pencil className="h-4 w-4" />
                                        </Button>
                                    )}
                                </div>
                            </TableCell>
                        </TableRow>
                    </TableBody>
                </Table>
            </div>

            <Dialog open={addPriceOpen} onOpenChange={setAddPriceOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>新增 {symbol} 股價</DialogTitle>

                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="date" className="text-right">
                                日期
                            </Label>
                            <Input
                                id="date"
                                type="date"
                                value={newPriceDate}
                                onChange={(e) => setNewPriceDate(e.target.value)}
                                className="col-span-3"
                                max={todayStr}
                            />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="price" className="text-right">
                                收盤價
                            </Label>
                            <Input
                                id="price"
                                type="number"
                                step="0.01"
                                placeholder="0.00"
                                value={newPriceValue}
                                onChange={(e) => setNewPriceValue(e.target.value)}
                                className="col-span-3"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setAddPriceOpen(false)}>取消</Button>
                        <Button onClick={handleAddPrice} disabled={submitting || !newPriceDate || !newPriceValue}>
                            {submitting ? "儲存中..." : "確認新增"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            {/* Delete Prices Confirmation Dialog */}
            <AlertDialog open={deletePricesOpen} onOpenChange={setDeletePricesOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>確定要刪除 {symbol} 的所有股價記錄嗎？</AlertDialogTitle>
                        <AlertDialogDescription>
                            此動作將刪除資料庫中屬於 {symbol} 的所有歷史股價。<br />
                            這主要用於測試或重置股價資料。<br />
                            <span className="text-destructive font-bold">此動作無法復原。</span>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isDeleting}>取消</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDeletePrices} disabled={isDeleting} className="bg-destructive hover:bg-destructive/90">
                            {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "確認刪除"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div >
    );
}
