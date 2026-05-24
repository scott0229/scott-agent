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
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Toaster } from "@/components/ui/toaster";

import { StockTradesTable } from '@/components/StockTradesTable';
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
    group_id?: string | number | null;
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
    const [pnlFilter, setPnlFilter] = useState<string>("All"); // All | Options | Stock — by include_in_options
    const [sortFilter, setSortFilter] = useState<string>("CloseDate");

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
                const sortedUsers = data.users.sort((a: User, b: User) => {
                    const nameA = a.user_id || a.email || '';
                    const nameB = b.user_id || b.email || '';
                    return nameA.localeCompare(nameB);
                });
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

        // P&L Type Filter — include_in_options===1 counts as 期權盈虧, else 股票盈虧
        if (pnlFilter === 'Options') {
            if (trade.include_in_options !== 1) return false;
        } else if (pnlFilter === 'Stock') {
            if (trade.include_in_options === 1) return false;
        }

        return true;
    });

    const sortedTrades = useMemo(() => {
        let result = [...filteredTrades];
        if (sortFilter === 'CloseDate') {
            result.sort((a, b) => {
                const aClose = a.close_date || Number.MAX_SAFE_INTEGER;
                const bClose = b.close_date || Number.MAX_SAFE_INTEGER;
                if (aClose !== bClose) return bClose - aClose; // Open positions (Infinity) first, then desc
                return b.open_date - a.open_date; // if both open or same close date, sort by open_date
            });
        } else if (sortFilter === 'OpenDate') {
            result.sort((a, b) => {
                return b.open_date - a.open_date;
            });
        }
        return result;
    }, [filteredTrades, sortFilter]);

    // Check if any filter is active
    const isFiltered = selectedUserFilter !== 'All' || statusFilter !== 'All' || symbolFilter !== '' || pnlFilter !== 'All';

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
                        // Exclude trade 'l' if it was closed on or before 't.open_date'
                        // (a trade closed on the same day should NOT count toward new positions opened that day)
                        if (!l.close_date || l.close_date > t.open_date) {
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
        const newColor = (!currentColor || currentColor === 'blue') ? 'red' : currentColor === 'red' ? 'green' : 'blue';
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

    const handleGroupUpdate = async (id: number, newGroupId: string | null) => {
        const originalTrades = [...trades];
        setTrades(prev => prev.map(t => t.id === id ? { ...t, group_id: newGroupId } : t));

        try {
            const res = await fetch(`/api/stocks/${id}/group`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ group_id: newGroupId }),
            });
            if (!res.ok) throw new Error('Update failed');
        } catch (error) {
            console.error('Group update failed', error);
            setTrades(originalTrades);
            toast({ variant: 'destructive', title: '操作失敗', description: '無法更新群組' });
        }
    };

    const displayYear = selectedYear === 'All' ? new Date().getFullYear() : parseInt(selectedYear);

    const totalProfit = useMemo(() => {
        return sortedTrades.reduce((sum, trade) => {
            const isClosed = trade.status === 'Closed';
            let pnl = 0;
            if (isClosed && trade.close_price) {
                pnl = (trade.close_price - trade.open_price) * trade.quantity;
            } else if (!isClosed && trade.current_market_price) {
                pnl = (trade.current_market_price - trade.open_price) * trade.quantity;
            }
            return sum + pnl;
        }, 0);
    }, [sortedTrades]);

    return (
            <div className="container mx-auto py-10">
                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-3xl font-bold">{mounted ? (selectedYear === 'All' ? new Date().getFullYear() : selectedYear) : ''} 股票交易</h1>
                    <div className="flex items-center gap-2">
                        <div className={cn(
                            "mr-2 px-4 h-10 flex items-center justify-center border border-input bg-background rounded-md text-sm shadow-sm",
                            totalProfit >= 0 
                                ? "text-status-positive" 
                                : "text-status-negative"
                        )}>
                            總盈虧 {totalProfit > 0 ? '+' : ''}{totalProfit.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        </div>

                        <Button
                            variant="outline"
                            size="icon"
                            onClick={() => {
                                setSelectedUserFilter("All");
                                setStatusFilter("All");
                                setSymbolFilter("");
                                setPnlFilter("All");
                            }}
                            className="mr-2 text-muted-foreground hover:text-primary"
                        >
                            <FilterX className="h-4 w-4" />
                        </Button>

                        {/* User Filter - Admin/Manager Only */}
                        {(currentUser?.role === 'admin' || currentUser?.role === 'manager') && (
                            <div className="w-[150px]">
                                <Select value={selectedUserFilter} onValueChange={setSelectedUserFilter}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="所有帳戶" />
                                    </SelectTrigger>
                                    <SelectContent className="max-h-none">
                                        <SelectItem value="All">所有帳戶</SelectItem>
                                        {users.map(u => (
                                            <SelectItem key={u.id} value={u.user_id || u.email}>
                                                {u.user_id || u.email}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}

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

                        {/* P&L Type Filter */}
                        <div className="w-[150px]">
                            <Select value={pnlFilter} onValueChange={setPnlFilter}>
                                <SelectTrigger>
                                    <SelectValue placeholder="全部盈虧" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="All">全部盈虧</SelectItem>
                                    <SelectItem value="Options">期權盈虧</SelectItem>
                                    <SelectItem value="Stock">股票盈虧</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Sorter */}
                        <div className="w-[150px]">
                            <Select value={sortFilter} onValueChange={setSortFilter}>
                                <SelectTrigger>
                                    <SelectValue placeholder="排序方式" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="CloseDate">依平倉日排序</SelectItem>
                                    <SelectItem value="OpenDate">依開倉日排序</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                    </div>
                </div>

                <StockTradesTable 
                    sortedTrades={sortedTrades}
                    runningDataMap={runningDataMap}
                    settings={settings}
                    currentUser={currentUser}
                    onColorToggle={handleColorToggle}
                    onNoteUpdate={handleNoteUpdate}
                    onGroupUpdate={handleGroupUpdate}
                    onToggleIncludeInOptions={handleToggleIncludeInOptions}
                    onUserClick={setSelectedUserFilter}
                    onSymbolClick={setSymbolFilter}
                    onTransferClick={(trade) => { setTradeToTransfer(trade); setTransferDialogOpen(true); }}
                    onEditClick={(trade) => { setTradeToEdit(trade); setDialogOpen(true); }}
                    formatMoney={formatMoney}
                    formatPnL={formatPnL}
                    formatDate={formatDate}
                />

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
    );
}
