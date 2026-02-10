'use client';

import { useState, useEffect } from 'react';
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
import { Input } from "@/components/ui/input";
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
import { MarketDataProgressDialog } from '@/components/MarketDataProgressDialog';
import { Pencil, Trash2, Plus, FilterX, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
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
import { useYearFilter } from '@/contexts/YearFilterContext';

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
    current_market_price?: number | null; // Current closing price from market_prices table
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
    const [isUpdatingMarketData, setIsUpdatingMarketData] = useState(false);
    const { toast } = useToast();
    const [progressDialogOpen, setProgressDialogOpen] = useState(false);

    // Filters
    const [selectedUserFilter, setSelectedUserFilter] = useState<string>("All"); // Filter by user_id string for display match
    const [statusFilter, setStatusFilter] = useState<string>("All");
    const [symbolFilter, setSymbolFilter] = useState("");

    // Dialogs
    const [dialogOpen, setDialogOpen] = useState(false);
    const [tradeToEdit, setTradeToEdit] = useState<StockTrade | null>(null);
    const [deleteId, setDeleteId] = useState<number | null>(null);
    const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
    const [bulkDeleting, setBulkDeleting] = useState(false);


    const { selectedYear } = useYearFilter();

    // Auth context (simplified)
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

    const handleDelete = async () => {
        if (!deleteId) return;
        try {
            const res = await fetch(`/api/stocks/${deleteId}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Delete failed');

            setTrades(prev => prev.filter(t => t.id !== deleteId));
            setTrades(prev => prev.filter(t => t.id !== deleteId));
        } catch (error) {
            console.error('Delete failed', error);
        } finally {
            setDeleteId(null);
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
        // Format with up to 2 decimal places, automatically removing trailing zeros
        return new Intl.NumberFormat('en-US', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
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
        if (statusFilter !== "All") {
            if (trade.status !== statusFilter) return false;
        }

        return true;
    });

    // Use backend's sorting order - no client-side re-sorting
    const sortedTrades = filteredTrades;

    // Check if any filter is active
    const isFiltered = selectedUserFilter !== 'All' || statusFilter !== 'All' || symbolFilter !== '';

    const canEdit = (trade: StockTrade) => {
        if (!currentUser) return false;
        if (currentUser.role === 'admin' || currentUser.role === 'manager') return true;
        return currentUser.user_id === trade.user_id; // Simple ownership check
    };

    const displayYear = selectedYear === 'All' ? new Date().getFullYear() : parseInt(selectedYear);

    const handleUpdateMarketData = () => {
        setProgressDialogOpen(true);
    };

    const handleProgressComplete = () => {
        fetchTrades(); // Refresh trades after update completes
    };

    const handleBulkDelete = async () => {
        if (filteredTrades.length === 0) return;
        setBulkDeleting(true);
        try {
            for (const trade of filteredTrades) {
                const res = await fetch(`/api/stocks/${trade.id}`, { method: 'DELETE' });
                if (!res.ok) throw new Error(`刪除 ${trade.symbol} 失敗`);
            }
            toast({ title: '刪除成功', description: `已刪除 ${filteredTrades.length} 筆交易` });
            setBulkDeleteDialogOpen(false);
            fetchTrades();
        } catch (error: any) {
            toast({ variant: 'destructive', title: '刪除失敗', description: error.message });
        } finally {
            setBulkDeleting(false);
        }
    };

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
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Symbol Filter */}
                        <div className="w-[150px]">
                            <Input
                                placeholder="搜尋代號..."
                                value={symbolFilter}
                                onChange={(e) => setSymbolFilter(e.target.value)}
                            />
                        </div>

                        {isFiltered && filteredTrades.length > 0 && canEdit(filteredTrades[0]) && (
                            <Button
                                variant="outline"
                                onClick={() => setBulkDeleteDialogOpen(true)}
                                className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                            >
                                <Trash2 className="h-4 w-4 mr-1.5" />
                                刪除篩選結果 ({filteredTrades.length})
                            </Button>
                        )}

                        <Button
                            variant="secondary"
                            onClick={handleUpdateMarketData}
                            disabled={isUpdatingMarketData}
                            className="hover:bg-accent hover:text-accent-foreground"
                        >
                            更新市場資料
                        </Button>

                        <Button
                            onClick={() => { setTradeToEdit(null); setDialogOpen(true); }}
                            variant="secondary"
                            className="hover:bg-accent hover:text-accent-foreground"
                        >
                            <span className="mr-0.5">+</span>新增
                        </Button>
                    </div>
                </div>

                <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-secondary hover:bg-secondary">
                                <TableHead className="w-[50px] text-center">#</TableHead>
                                <TableHead className="text-center">持有者</TableHead>
                                <TableHead className="text-center">開倉日</TableHead>
                                <TableHead className="text-center">平倉日</TableHead>
                                <TableHead className="text-center">標的</TableHead>
                                <TableHead className="text-center">股數</TableHead>
                                <TableHead className="text-center">開倉價</TableHead>
                                <TableHead className="text-center">當前股價</TableHead>
                                <TableHead className="text-center">平倉價</TableHead>
                                <TableHead className="text-center">盈虧</TableHead>
                                <TableHead className="text-center">交易代碼</TableHead>
                                <TableHead className="text-right"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {sortedTrades.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={12} className="h-24 text-center">
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
                                        <TableRow key={trade.id}>
                                            <TableCell className="text-center text-muted-foreground font-mono">{sortedTrades.length - index}</TableCell>
                                            <TableCell className="text-center">
                                                <span
                                                    className="cursor-pointer hover:text-primary hover:underline hover:font-semibold transition-all duration-150"
                                                    onClick={() => setSelectedUserFilter(trade.user_id || '')}
                                                    title={`點擊過濾 ${trade.user_id} 的交易`}
                                                >
                                                    {trade.user_id || '-'}
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-center">{formatDate(trade.open_date)}</TableCell>
                                            <TableCell className={cn("text-center", !trade.close_date && "bg-pink-50")}>
                                                {trade.close_date ? formatDate(trade.close_date) : 'Open'}
                                            </TableCell>
                                            <TableCell className="text-center">
                                                <span
                                                    className="cursor-pointer hover:text-primary hover:underline hover:font-semibold transition-all duration-150"
                                                    onClick={() => setSymbolFilter(trade.symbol)}
                                                    title={`點擊過濾 ${trade.symbol} 的交易`}
                                                >
                                                    {trade.symbol}
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-center">{trade.quantity.toLocaleString()}</TableCell>
                                            <TableCell className="text-center">{formatMoney(trade.open_price)}</TableCell>
                                            <TableCell className="text-center">
                                                {trade.current_market_price ? formatMoney(trade.current_market_price) : '-'}
                                            </TableCell>
                                            <TableCell className="text-center">
                                                {trade.close_price ? formatMoney(trade.close_price) : '-'}
                                            </TableCell>
                                            <TableCell className={cn("text-center", pnl !== null && pnl < 0 && 'bg-pink-50')}>
                                                {pnl !== null ? formatPnL(pnl) : '-'}
                                            </TableCell>
                                            <TableCell className="text-center font-mono text-sm">
                                                {trade.code || '-'}
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex justify-end gap-1">
                                                    {canEdit(trade) && (
                                                        <>
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

                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        className="text-muted-foreground hover:text-red-600 hover:bg-red-50"
                                                                        onClick={() => setDeleteId(trade.id)}
                                                                    >
                                                                        <Trash2 className="h-4 w-4" />
                                                                    </Button>
                                                                </TooltipTrigger>
                                                                <TooltipContent>
                                                                    <p>刪除</p>
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

                <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>確認刪除?</AlertDialogTitle>
                            <AlertDialogDescription>這筆交易將被永久刪除且無法復原。</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>取消</AlertDialogCancel>
                            <AlertDialogAction className="bg-red-600" onClick={handleDelete}>刪除</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>

                {/* Market Data Progress Dialog */}
                <MarketDataProgressDialog
                    open={progressDialogOpen}
                    onOpenChange={setProgressDialogOpen}
                    userId={currentUser?.id || 1}
                    year={displayYear}
                    onComplete={handleProgressComplete}
                />
                {/* Bulk Delete Confirmation Dialog */}
                <AlertDialog open={bulkDeleteDialogOpen} onOpenChange={(open) => { if (!bulkDeleting) setBulkDeleteDialogOpen(open); }}>
                    <AlertDialogContent className="max-w-lg">
                        <AlertDialogHeader>
                            <AlertDialogTitle>確認刪除 {filteredTrades.length} 筆交易？</AlertDialogTitle>
                            <AlertDialogDescription asChild>
                                <div className="space-y-3">
                                    <p>以下交易將被永久刪除且無法復原：</p>
                                    <div className="max-h-[300px] overflow-y-auto border rounded">
                                        <Table>
                                            <TableHeader>
                                                <TableRow className="bg-secondary hover:bg-secondary">
                                                    <TableHead className="text-center">持有者</TableHead>
                                                    <TableHead className="text-center">標的</TableHead>
                                                    <TableHead className="text-center">開倉日</TableHead>
                                                    <TableHead className="text-center">狀態</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {filteredTrades.map(t => (
                                                    <TableRow key={t.id}>
                                                        <TableCell className="text-center">{t.user_id}</TableCell>
                                                        <TableCell className="text-center">{t.symbol}</TableCell>
                                                        <TableCell className="text-center">{formatDate(t.open_date)}</TableCell>
                                                        <TableCell className="text-center">{t.status === 'Open' ? 'Open' : 'Closed'}</TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>
                                </div>
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel disabled={bulkDeleting}>取消</AlertDialogCancel>
                            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={handleBulkDelete} disabled={bulkDeleting}>
                                {bulkDeleting ? '刪除中...' : `刪除 ${filteredTrades.length} 筆`}
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>

                <Toaster />
            </div>
        </TooltipProvider>
    );
}
