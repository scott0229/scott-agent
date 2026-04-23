'use client';

import { useState, useEffect, useMemo } from 'react';
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

import { Badge } from "@/components/ui/badge";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Toaster } from "@/components/ui/toaster";

import { StockTradeDialog } from '@/components/StockTradeDialog';
import { TransferStockDialog } from '@/components/TransferStockDialog';
import { Pencil, FilterX, ArrowRightLeft } from "lucide-react";
import { cn } from "@/lib/utils";

import { useYearFilter } from '@/contexts/YearFilterContext';
import { useAdminSettings } from '@/contexts/AdminSettingsContext';

interface StockTrade {
    id: number;
    user_id: string; // The API returns string user_id
    owner_id: number;
    year: number;
    symbol: string;
    status: 'Open' | 'Closed';
    open_date: number;
    close_date?: number | null;
    open_price: number;
    close_price?: number | null;
    quantity: number;
    code?: string;
    source?: string; // e.g. 'assigned'
    close_source?: string; // e.g. 'assigned'
    current_market_price?: number | null; // Current closing price from market_prices table
    include_in_options?: number; // 1 = include stock P&L in options revenue
    note?: string | null;
    note_color?: string | null;
}

interface User {
    id: number;
    user_id: string;
    email: string;
    role: string;
    current_net_equity?: number;
}

export default function StockTradingPage() {
    const [trades, setTrades] = useState<StockTrade[]>([]);
    const [loading, setLoading] = useState(true);
    const [users, setUsers] = useState<User[]>([]);
    const { toast } = useToast();

    // Filters
    const [selectedUserFilter, setSelectedUserFilter] = useState<string>("All"); // Filter by user_id string for display match
    const [statusFilter, setStatusFilter] = useState<string>("All");
    const [symbolFilter, setSymbolFilter] = useState("");

    const [dialogOpen, setDialogOpen] = useState(false);
    const [tradeToEdit, setTradeToEdit] = useState<StockTrade | null>(null);
    const [transferDialogOpen, setTransferDialogOpen] = useState(false);
    const [tradeToTransfer, setTradeToTransfer] = useState<StockTrade | null>(null);


    const { selectedYear } = useYearFilter();
    const { settings } = useAdminSettings();

    // Auth context (simplified)
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
        fetchCurrentUser();
    }, []);

    useEffect(() => {
        fetchUsers();
        fetchTrades();
    }, [selectedYear]);

    const fetchCurrentUser = async () => {
        try {
            const res = await fetch('/api/auth/me');
            if (res.ok) {
                const data = await res.json();
                setCurrentUser(data.user);
            }
        } catch (e) { console.error(e); }
    };

    const fetchUsers = async () => {
        try {
            // Filter users by selected Year (or current year if All)
            const year = selectedYear === 'All' ? new Date().getFullYear() : selectedYear;
            const res = await fetch(`/api/users?year=${year}`);
            const data = await res.json();
            if (data.users) {
                const sortedUsers = data.users.sort((a: User, b: User) => (b.current_net_equity || 0) - (a.current_net_equity || 0));
                setUsers(sortedUsers);
            }
        } catch (e) {
            console.error('Failed to fetch users', e);
        }
    };

    const fetchTrades = async () => {
        setLoading(true);
        try {
            const yearParam = selectedYear === 'All' ? '' : `&year=${selectedYear}`;
            // If normal user, maybe API restricts? Assuming API handles filtering if we don't pass userId
            let url = `/api/stocks?dummy=1${yearParam}`;

            // Should we filter by user here or let the user filter on UI?
            // If admin, we fetch all. If user, API returns only theirs ideally.
            // Let's rely on API response.

            const res = await fetch(url);
            const data = await res.json();
            if (data.stocks) {
                setTrades(data.stocks);
            }
        } catch (error) {
            console.error('Failed to fetch trades', error);
        } finally {
            setLoading(false);
        }
    };



    const formatDate = (ts: number) => {
        return format(new Date(ts * 1000), "yy-MM-dd");
    };

    const formatMoney = (val: number | null | undefined) => {
        if (val === null || val === undefined) return '-';
        return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
    };

    const formatPnL = (val: number | null | undefined) => {
        if (val === null || val === undefined) return '-';
        return new Intl.NumberFormat('en-US', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(val);
    };

    // Filter Logic
    const filteredTrades = trades.filter(trade => {
        // User Filter
        if (selectedUserFilter !== "All") {
            // Match against user_id string or if we had ID mapping
            // API returns user_id string in trade.user_id
            // Filter value is user_id string
            if (trade.user_id !== selectedUserFilter) return false;
        }

        // Symbol Filter
        if (symbolFilter) {
            if (trade.symbol !== symbolFilter.toUpperCase()) return false;
        }

        // Status Filter
        if (statusFilter === 'Assigned') {
            if (trade.source !== 'assigned' && trade.close_source !== 'assigned') return false;
        } else if (statusFilter !== "All") {
            if (trade.status !== statusFilter) return false;
        }

        return true;
    });

    // Use backend's sorting order - no client-side re-sorting
    const sortedTrades = filteredTrades;

    // Check if any filter is active
    const isFiltered = selectedUserFilter !== 'All' || statusFilter !== 'All' || symbolFilter !== '';

    // Calculate running total of shares for each trade chronologically (grouped by day to avoid artificial intra-day partial sums)
    const runningDataMap = useMemo(() => {
        const map: Record<number, { total: number; avgPrice: number | null }> = {};
        
        // Group trades by user+symbol
        const grouped: Record<string, StockTrade[]> = {};
        trades.forEach(t => {
            const key = `${t.user_id}_${t.symbol}`;
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(t);
        });

        Object.values(grouped).forEach(group => {
            // Calculate running total for each trade based on daily snapshots
            group.forEach(t => {
                let total = 0;
                let totalCost = 0;
                group.forEach(l => {
                    // Include trade 'l' if it was opened on or before 't.open_date'
                    if (l.open_date <= t.open_date) {
                        // Exclude trade 'l' ONLY if it was closed strictly before 't.open_date'
                        if (!l.close_date || l.close_date >= t.open_date) {
                            total += l.quantity;
                            totalCost += l.quantity * l.open_price;
                        }
                    }
                });
                map[t.id] = {
                    total,
                    avgPrice: total > 0 ? totalCost / total : null
                };
            });
        });
        return map;
    }, [trades]);

    const canEdit = (trade: StockTrade) => {
        if (!currentUser) return false;
        if (currentUser.role === 'admin' || currentUser.role === 'manager') return true;
        return currentUser.user_id === trade.user_id; // Simple ownership check
    };

    const handleToggleIncludeInOptions = async (trade: StockTrade) => {
        let newValue = 0;
        if (trade.include_in_options === 0 || !trade.include_in_options) {
            newValue = 1;
        } else if (trade.include_in_options === 1) {
            newValue = 2;
        } else {
            newValue = 0;
        }

        const originalValue = trade.include_in_options;
        setTrades(prev => prev.map(t => t.id === trade.id ? { ...t, include_in_options: newValue } : t));

        try {
            const res = await fetch(`/api/stocks/${trade.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: trade.id, include_in_options: newValue }),
            });
            if (!res.ok) throw new Error('Toggle failed');
        } catch (error) {
            console.error('Toggle include_in_options failed', error);
            setTrades(prev => prev.map(t => t.id === trade.id ? { ...t, include_in_options: originalValue } : t));
            toast({ variant: 'destructive', title: '操作失敗', description: '無法更新列入期權設定' });
        }
    };

    const handleColorToggle = async (id: number, currentColor: string | null | undefined) => {
        const newColor = currentColor === 'red' ? 'blue' : 'red';
        setTrades(prev => prev.map(t => t.id === id ? { ...t, note_color: newColor } : t));

        try {
            const res = await fetch(`/api/stocks/${id}/note`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ note_color: newColor })
            });
            if (!res.ok) throw new Error('Failed to update note color');
        } catch (error) {
            console.error('Note color update error', error);
            setTrades(prev => prev.map(t => t.id === id ? { ...t, note_color: currentColor } : t));
            toast({ variant: 'destructive', title: '操作失敗', description: '無法更新註解顏色' });
        }
    };

    const handleNoteUpdate = async (id: number, note: string) => {
        const originalTrades = [...trades];
        setTrades(prev => prev.map(t => t.id === id ? { ...t, note } : t));

        try {
            const res = await fetch(`/api/stocks/${id}/note`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ note }),
            });
            if (!res.ok) throw new Error('Update failed');
        } catch (error) {
            console.error('Note update failed', error);
            setTrades(originalTrades);
            toast({ variant: 'destructive', title: '操作失敗', description: '無法更新註解' });
        }
    };

    const displayYear = selectedYear === 'All' ? new Date().getFullYear() : parseInt(selectedYear);




    return (
        <TooltipProvider delayDuration={300}>
            <div className="container mx-auto py-10">
                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-3xl font-bold">{mounted ? (selectedYear === 'All' ? new Date().getFullYear() : selectedYear) : ''} 股票交易</h1>
                    <div className="flex items-center gap-2">

                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={() => {
                                        setSelectedUserFilter("All");
                                        setStatusFilter("All");
                                        setSymbolFilter("");
                                    }}
                                    className="mr-2 text-muted-foreground hover:text-primary"
                                >
                                    <FilterX className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>重置篩選</p>
                            </TooltipContent>
                        </Tooltip>

                        {/* User Filter - Admin/Manager Only */}
                        {(currentUser?.role === 'admin' || currentUser?.role === 'manager') && (
                            <div className="w-[150px]">
                                <Select value={selectedUserFilter} onValueChange={setSelectedUserFilter}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="所有用戶" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="All">所有用戶</SelectItem>
                                        {users.map(u => (
                                            <SelectItem key={u.id} value={u.user_id || u.email}>
                                                {u.user_id || u.email}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}

                        {/* Status Filter */}
                        <div className="w-[150px]">
                            <Select value={statusFilter} onValueChange={setStatusFilter}>
                                <SelectTrigger>
                                    <SelectValue placeholder="所有狀態" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="All">所有狀態</SelectItem>
                                    <SelectItem value="Open">Open</SelectItem>
                                    <SelectItem value="Closed">Closed</SelectItem>
                                    <SelectItem value="Assigned">被指派</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Symbol Filter */}
                        <div className="w-[150px]">
                            <Select value={symbolFilter || "All"} onValueChange={(val) => setSymbolFilter(val === "All" ? "" : val)}>
                                <SelectTrigger>
                                    <SelectValue placeholder="所有代號" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="All">所有代號</SelectItem>
                                    {[...new Set(trades.map(t => t.symbol))].sort().map(sym => (
                                        <SelectItem key={sym} value={sym}>{sym}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>





                    </div>
                </div>

                <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-secondary hover:bg-secondary">
                                <TableHead className="w-[50px] text-center"></TableHead>
                                <TableHead className="text-left">註解</TableHead>
                                <TableHead className="text-center">持有者</TableHead>
                                <TableHead className="text-center">開倉日</TableHead>
                                <TableHead className="text-center">平倉日</TableHead>
                                <TableHead className="text-center">標的</TableHead>
                                <TableHead className="text-center">股數</TableHead>
                                <TableHead className="text-center">開倉價</TableHead>
                                <TableHead className="text-center">平倉價</TableHead>
                                <TableHead className="text-center">當前股價</TableHead>
                                <TableHead className="text-center">盈虧</TableHead>
                                <TableHead className="text-center">開倉後總股數</TableHead>
                                <TableHead className="text-center">列入期權</TableHead>
                                {settings.showTradeCode && <TableHead className="text-center">交易代碼</TableHead>}
                                <TableHead className="text-right"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {sortedTrades.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={13} className="h-24 text-center">
                                        無交易紀錄
                                    </TableCell>
                                </TableRow>
                            ) : (
                                sortedTrades.map((trade, index) => {
                                    const isClosed = trade.status === 'Closed';

                                    // Calculate P/L based on trade status
                                    let pnl: number | null = null;
                                    if (isClosed && trade.close_price) {
                                        // For closed positions: use close_price
                                        pnl = Math.round((trade.close_price - trade.open_price) * trade.quantity * 100) / 100;
                                    } else if (!isClosed && trade.current_market_price) {
                                        // For holding positions: use current_market_price (收盤價)
                                        pnl = Math.round((trade.current_market_price - trade.open_price) * trade.quantity * 100) / 100;
                                    }

                                    return (
                                        <TableRow key={trade.id} className="h-[40px]">
                                            <TableCell className="text-center text-muted-foreground font-mono py-1">
                                                <div className="flex items-center justify-center gap-4">
                                                    <span>{sortedTrades.length - index}</span>
                                                    {trade.note?.trim() ? (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleColorToggle(trade.id, trade.note_color);
                                                            }}
                                                            className={`w-4 h-4 rounded-full shrink-0 shadow-sm transition-colors opacity-90 hover:opacity-100 ${
                                                                trade.note_color === 'red' ? 'bg-red-500' : 'bg-blue-500'
                                                            }`}
                                                            title="切換註解顏色"
                                                        />
                                                    ) : (
                                                        <div className="w-4 h-4 shrink-0" />
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell className="py-1 min-w-[180px]">
                                                <input 
                                                    className="w-full bg-transparent border-b border-transparent hover:border-gray-300 focus:border-primary focus:outline-none transition-colors px-1 text-left text-[13px] font-medium"
                                                    style={{ color: trade.note_color === 'red' ? '#7f1d1d' : '#1e3a8a' }}
                                                    maxLength={50}
                                                    defaultValue={trade.note || ''}
                                                    placeholder="..."
                                                    onBlur={(e) => {
                                                        if (e.target.value !== (trade.note || '')) {
                                                            handleNoteUpdate(trade.id, e.target.value);
                                                        }
                                                    }}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            e.currentTarget.blur();
                                                        }
                                                    }}
                                                />
                                            </TableCell>
                                            <TableCell className="text-center py-1">
                                                <span
                                                    className="cursor-pointer hover:text-primary hover:underline hover:font-semibold transition-all duration-150"
                                                    onClick={() => setSelectedUserFilter(trade.user_id || '')}
                                                    title={`點擊過濾 ${trade.user_id} 的交易`}
                                                >
                                                    {trade.user_id || '-'}
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-center py-1">
                                                {formatDate(trade.open_date)}
                                                {trade.source === 'assigned' && <span className="text-xs text-green-700 font-medium ml-1">(被指派)</span>}
                                            </TableCell>
                                            <TableCell className={cn("text-center py-1", !trade.close_date && "bg-pink-50")}>
                                                {trade.close_date ? formatDate(trade.close_date) : 'Open'}
                                                {trade.close_source === 'assigned' && <span className="text-xs text-green-700 font-medium ml-1">(被指派)</span>}
                                                {trade.close_source === 'transfer' && <span className="text-xs text-gray-500 font-medium ml-1">(Transferred)</span>}
                                            </TableCell>
                                            <TableCell className="text-center py-1">
                                                <span
                                                    className="cursor-pointer hover:text-primary hover:underline hover:font-semibold transition-all duration-150"
                                                    onClick={() => setSymbolFilter(trade.symbol)}
                                                    title={`點擊過濾 ${trade.symbol} 的交易`}
                                                >
                                                    {trade.symbol}
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-center py-1">{trade.quantity.toLocaleString()}</TableCell>
                                            <TableCell className="text-center py-1">{formatMoney(trade.open_price)}</TableCell>
                                            <TableCell className="text-center py-1">
                                                {trade.close_price ? formatMoney(trade.close_price) : '-'}
                                            </TableCell>
                                            <TableCell className="text-center py-1">
                                                {isClosed ? '-' : (trade.current_market_price ? formatMoney(trade.current_market_price) : '-')}
                                            </TableCell>
                                            <TableCell className={cn("text-center py-1", pnl !== null && pnl < 0 && 'bg-pink-50')}>
                                                {pnl !== null ? formatPnL(pnl) : '-'}
                                            </TableCell>
                                            <TableCell className="text-center py-1 whitespace-nowrap">
                                                {runningDataMap[trade.id]?.total > 0 
                                                    ? (
                                                        <div className="flex items-center justify-center gap-1">
                                                            <span>{runningDataMap[trade.id].total.toLocaleString()}</span>
                                                            <span className="text-xs text-muted-foreground font-medium">(均價 {formatMoney(runningDataMap[trade.id].avgPrice)})</span>
                                                        </div>
                                                    )
                                                    : '-'}
                                            </TableCell>
                                            <TableCell className="text-center py-1">
                                                {isClosed && trade.close_price ? (
                                                    <button
                                                        onClick={() => handleToggleIncludeInOptions(trade)}
                                                        className={cn(
                                                            "inline-flex items-center justify-center w-6 h-6 rounded-full border transition-all duration-200 cursor-pointer",
                                                            trade.include_in_options === 1
                                                                ? "bg-green-100 border-green-400 text-green-700 hover:bg-green-200"
                                                                : trade.include_in_options === 2
                                                                    ? "bg-red-100 border-red-400 text-red-700 hover:bg-red-200"
                                                                    : "bg-gray-50 border-gray-300 text-gray-400 hover:bg-gray-100 hover:text-gray-500"
                                                        )}
                                                    >
                                                        {trade.include_in_options === 1 ? '✓' : trade.include_in_options === 2 ? '✕' : ''}
                                                    </button>
                                                ) : (
                                                    <span className="text-gray-300">-</span>
                                                )}
                                            </TableCell>
                                            {settings.showTradeCode && (
                                                <TableCell className="text-center font-mono text-sm py-1">
                                                    {trade.code || '-'}
                                                </TableCell>
                                            )}
                                            <TableCell className="py-1">
                                                <div className="flex justify-end gap-1">
                                                    {canEdit(trade) && (
                                                        <>
                                                            {!isClosed && (
                                                                <Tooltip>
                                                                    <TooltipTrigger asChild>
                                                                        <Button
                                                                            variant="ghost"
                                                                            size="icon"
                                                                            onClick={() => { setTradeToTransfer(trade); setTransferDialogOpen(true); }}
                                                                            className="text-muted-foreground hover:text-orange-500 hover:bg-orange-50"
                                                                        >
                                                                            <ArrowRightLeft className="h-4 w-4" />
                                                                        </Button>
                                                                    </TooltipTrigger>
                                                                    <TooltipContent>
                                                                        <p>手動轉倉 (平倉)</p>
                                                                    </TooltipContent>
                                                                </Tooltip>
                                                            )}
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        onClick={() => { setTradeToEdit(trade); setDialogOpen(true); }}
                                                                        className="text-muted-foreground hover:text-primary hover:bg-primary/10"
                                                                    >
                                                                        <Pencil className="h-4 w-4" />
                                                                    </Button>
                                                                </TooltipTrigger>
                                                                <TooltipContent>
                                                                    <p>編輯</p>
                                                                </TooltipContent>
                                                            </Tooltip>


                                                        </>
                                                    )}
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })
                            )}
                        </TableBody>
                    </Table>
                </div>

                <StockTradeDialog
                    open={dialogOpen}
                    onOpenChange={setDialogOpen}
                    tradeToEdit={tradeToEdit}
                    onSuccess={() => { fetchTrades(); }}
                    year={displayYear}
                />

                <TransferStockDialog
                    open={transferDialogOpen}
                    onOpenChange={setTransferDialogOpen}
                    tradeToTransfer={tradeToTransfer}
                    onSuccess={() => { fetchTrades(); }}
                />



                <Toaster />
            </div>
        </TooltipProvider>
    );
}
