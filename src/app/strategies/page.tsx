'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Target, Plus, Pencil, Trash2, Bookmark, BookmarkCheck, FilterX, StickyNote, AlertTriangle } from 'lucide-react';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { StrategyDialog } from '@/components/StrategyDialog';
import { AnnotationDialog } from '@/components/AnnotationDialog';
import { useYearFilter } from '@/contexts/YearFilterContext';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface StockTrade {
    id: number;
    symbol: string;
    status: string;
    user_id: string;
    code: string;
    open_date: number;
    quantity: number;
    open_price: number;
    close_price?: number | null;
    close_date?: number | null;
    current_market_price?: number | null;
    source?: string | null;
}

interface Option {
    id: number;
    underlying: string;
    type: string; // CALL or PUT
    operation: string;
    user_id: string;
    code: string;
    final_profit?: number | null;
    quantity: number;
    open_date: number;
    to_date?: number | null;
    strike_price?: number | null;
    settlement_date?: number | null;
}

interface Strategy {
    id: number;
    name: string;
    user_id: string;
    owner_id: number;
    year: number;
    status?: string;
    option_strategy?: string;
    stock_strategy?: string;
    stock_strategy_params?: string;
    stocks: StockTrade[];
    options: Option[];
    created_at: number;
    updated_at: number;
}

interface AnnotationItem {
    id: number;
    symbol: string;
}

interface Annotation {
    id: number;
    year: number;
    description: string | null;
    items: AnnotationItem[];
    owners: { owner_id: number; user_id: string }[];
    created_at: number;
    updated_at: number;
}

export default function StrategiesPage() {
    const { toast } = useToast();
    const { selectedYear } = useYearFilter();
    const [strategies, setStrategies] = useState<Strategy[]>([]);
    const [loading, setLoading] = useState(true);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [selectedStrategy, setSelectedStrategy] = useState<Strategy | null>(null);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [strategyToDelete, setStrategyToDelete] = useState<Strategy | null>(null);
    const [sortOrder, setSortOrder] = useState<'date-new' | 'date-old' | 'status-new' | 'status-old'>('status-new');
    const [users, setUsers] = useState<{ id: number; user_id: string; email: string; current_net_equity?: number }[]>([]);
    const [selectedUserId, setSelectedUserId] = useState<string>('all');
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [symbolFilter, setSymbolFilter] = useState<string>('all');
    const [stockSymbolFilters, setStockSymbolFilters] = useState<Record<number, string>>({});
    const [optionSymbolFilters, setOptionSymbolFilters] = useState<Record<number, string>>({});
    const [filtersSaved, setFiltersSaved] = useState(false);
    const [annotations, setAnnotations] = useState<Annotation[]>([]);
    const [annotationDialogOpen, setAnnotationDialogOpen] = useState(false);
    const [selectedAnnotation, setSelectedAnnotation] = useState<Annotation | null>(null);
    const [deleteAnnotationDialogOpen, setDeleteAnnotationDialogOpen] = useState(false);
    const [annotationToDelete, setAnnotationToDelete] = useState<Annotation | null>(null);

    // Load saved filters from localStorage on mount
    useEffect(() => {
        try {
            const saved = localStorage.getItem('strategy-filters');
            if (saved) {
                const filters = JSON.parse(saved);
                if (filters.selectedUserId) setSelectedUserId(filters.selectedUserId);
                if (filters.statusFilter) setStatusFilter(filters.statusFilter);
                if (filters.symbolFilter) setSymbolFilter(filters.symbolFilter);
                if (filters.sortOrder) setSortOrder(filters.sortOrder);
                setFiltersSaved(true);
            }
        } catch (e) {
            console.error('Failed to load saved filters:', e);
        }
    }, []);

    const handleSaveFilters = () => {
        if (filtersSaved) {
            localStorage.removeItem('strategy-filters');
            setFiltersSaved(false);
            toast({ title: '已清除篩選記憶' });
        } else {
            const filters = { selectedUserId, statusFilter, symbolFilter, sortOrder };
            localStorage.setItem('strategy-filters', JSON.stringify(filters));
            setFiltersSaved(true);
            toast({ title: '已記住篩選設定' });
        }
    };

    useEffect(() => {
        fetchUsers();
        fetchStrategies();
        fetchAnnotations();
    }, [selectedYear]);


    const fetchUsers = async () => {
        try {
            const year = selectedYear === 'All' ? new Date().getFullYear() : selectedYear;
            const res = await fetch(`/api/users?year=${year}`);
            if (res.ok) {
                const data = await res.json();
                // Only show customer-role users
                let filteredUsers = data.users.filter((u: any) => u.role === 'customer');

                // Deduplicate by user_id
                const uniqueUsers: { id: number; user_id: string; email: string; current_net_equity?: number }[] = [];
                const seen = new Set<string>();
                for (const u of filteredUsers) {
                    const key = u.user_id || u.email;
                    if (!seen.has(key)) {
                        seen.add(key);
                        uniqueUsers.push(u);
                    }
                }

                setUsers(uniqueUsers);
            }
        } catch (error) {
            console.error('Failed to fetch users:', error);
        }
    };

    const fetchStrategies = async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/strategies?year=${selectedYear}`);
            if (res.ok) {
                const data = await res.json();
                setStrategies(data.strategies || []);
            } else {
                toast({
                    title: '錯誤',
                    description: '無法載入策略',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error('Failed to fetch strategies:', error);
            toast({
                title: '錯誤',
                description: '網路錯誤',
                variant: 'destructive',
            });
        } finally {
            setLoading(false);
        }
    };

    // Silent refresh: update data without loading flash, preserve scroll position
    const refreshStrategiesSilently = async () => {
        try {
            const res = await fetch(`/api/strategies?year=${selectedYear}`);
            if (res.ok) {
                const data = await res.json();
                setStrategies(data.strategies || []);
            }
        } catch (error) {
            console.error('Failed to silently refresh strategies:', error);
        }
    };

    const fetchAnnotations = async () => {
        try {
            const res = await fetch(`/api/annotations?year=${selectedYear}`);
            if (res.ok) {
                const data = await res.json();
                setAnnotations(data.annotations || []);
            }
        } catch (error) {
            console.error('Failed to fetch annotations:', error);
        }
    };

    const handleAddAnnotation = () => {
        setSelectedAnnotation(null);
        setAnnotationDialogOpen(true);
    };

    const handleEditAnnotation = (annotation: Annotation) => {
        setSelectedAnnotation(annotation);
        setAnnotationDialogOpen(true);
    };

    const handleDeleteAnnotationClick = (annotation: Annotation) => {
        setAnnotationToDelete(annotation);
        setDeleteAnnotationDialogOpen(true);
    };

    const handleDeleteAnnotationConfirm = async () => {
        if (!annotationToDelete) return;
        try {
            const res = await fetch(`/api/annotations?id=${annotationToDelete.id}`, { method: 'DELETE' });
            if (res.ok) {
                fetchAnnotations();
            } else {
                const data = await res.json();
                toast({ title: '錯誤', description: data.error || '刪除失敗', variant: 'destructive' });
            }
        } catch (error) {
            toast({ title: '錯誤', description: '網路錯誤', variant: 'destructive' });
        } finally {
            setDeleteAnnotationDialogOpen(false);
            setAnnotationToDelete(null);
        }
    };

    const handleAddStrategy = () => {
        setSelectedStrategy(null);
        setDialogOpen(true);
    };

    const handleEditStrategy = (strategy: Strategy) => {
        setSelectedStrategy(strategy);
        setDialogOpen(true);
    };

    const handleDeleteClick = (strategy: Strategy) => {
        setStrategyToDelete(strategy);
        setDeleteDialogOpen(true);
    };

    const handleDeleteConfirm = async () => {
        if (!strategyToDelete) return;

        try {
            const res = await fetch(`/api/strategies/${strategyToDelete.id}`, {
                method: 'DELETE',
            });

            if (res.ok) {
                fetchStrategies();
            } else {
                const data = await res.json();
                toast({
                    title: '錯誤',
                    description: data.error || '刪除失敗',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            toast({
                title: '錯誤',
                description: '網路錯誤',
                variant: 'destructive',
            });
        } finally {
            setDeleteDialogOpen(false);
            setStrategyToDelete(null);
        }
    };

    return (
        <div className="container mx-auto p-6 space-y-6">
            {/* Header */}
            <div className="flex justify-between items-center">
                <h1 className="text-3xl font-bold">
                    2026 投資策略
                </h1>
                <div className="flex gap-2 items-center">
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={handleSaveFilters}
                        title={filtersSaved ? '清除篩選記憶' : '記住篩選設定'}
                    >
                        {filtersSaved ? <BookmarkCheck className="h-4 w-4 text-amber-600" /> : <Bookmark className="h-4 w-4" />}
                    </Button>
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={() => { setSelectedUserId('all'); setStatusFilter('all'); setSymbolFilter('all'); setSortOrder('status-new'); }}
                        title="重置篩選"
                    >
                        <FilterX className="h-4 w-4" />
                    </Button>
                    <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                        <SelectTrigger className="w-[150px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">全部用戶</SelectItem>
                            {users.map(user => (
                                <SelectItem key={user.id} value={user.user_id}>
                                    {user.user_id}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                        <SelectTrigger className="w-[130px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">全部狀態</SelectItem>
                            <SelectItem value="進行中">進行中</SelectItem>
                            <SelectItem value="已結案">已結案</SelectItem>
                        </SelectContent>
                    </Select>
                    <Select value={symbolFilter} onValueChange={setSymbolFilter}>
                        <SelectTrigger className="w-[130px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">全部標的</SelectItem>
                            {(() => {
                                const allSymbols = new Set<string>();
                                strategies.forEach(s => {
                                    s.stocks.forEach(st => allSymbols.add(st.symbol));
                                    s.options.forEach(o => allSymbols.add(o.underlying));
                                });
                                return [...allSymbols].sort().map(sym => (
                                    <SelectItem key={sym} value={sym}>{sym}</SelectItem>
                                ));
                            })()}
                        </SelectContent>
                    </Select>
                    <Select value={sortOrder} onValueChange={(value: 'date-new' | 'date-old' | 'status-new' | 'status-old') => setSortOrder(value)}>
                        <SelectTrigger className="w-[200px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="date-new">建立時間-從新到舊</SelectItem>
                            <SelectItem value="date-old">建立時間-從舊到新</SelectItem>
                            <SelectItem value="status-new">未結案-新到舊</SelectItem>
                            <SelectItem value="status-old">未結案-舊到新</SelectItem>
                        </SelectContent>
                    </Select>
                    <Button onClick={handleAddAnnotation} variant="outline" className="gap-2">
                        <StickyNote className="h-4 w-4" />
                        新增註解
                    </Button>
                    <Button onClick={handleAddStrategy} variant="secondary" className="gap-2 hover:bg-accent hover:text-accent-foreground">
                        <Plus className="h-4 w-4" />
                        新增
                    </Button>
                </div>
            </div>

            {/* Annotations Section */}
            {annotations
                .filter(a => selectedUserId === 'all' || a.owners.some(o => o.user_id === selectedUserId))
                .length > 0 && (
                    <div className="space-y-3">
                        {annotations
                            .filter(a => selectedUserId === 'all' || a.owners.some(o => o.user_id === selectedUserId))
                            .map(annotation => (
                                <div key={annotation.id} className="border-2 border-gray-300 bg-amber-50 rounded-lg px-4 py-3 flex items-start justify-between gap-4">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-amber-700 font-medium text-sm">📌</span>
                                            {annotation.owners.length >= users.length && users.length > 0 ? (
                                                <span className="bg-gray-200 px-2 py-0.5 rounded text-sm font-bold">全部用戶</span>
                                            ) : (
                                                annotation.owners.map((owner, idx) => (
                                                    <span key={idx} className="bg-gray-200 px-2 py-0.5 rounded text-sm font-bold cursor-pointer hover:bg-gray-300 transition-colors" onClick={() => setSelectedUserId(owner.user_id)}>{owner.user_id}</span>
                                                ))
                                            )}
                                            {annotation.items.map((item, idx) => (
                                                <span key={idx} className="text-sm">
                                                    {idx > 0 && <span className="text-muted-foreground mr-1">|</span>}
                                                    <span className="bg-yellow-100 px-1 rounded">{item.symbol}</span>
                                                </span>
                                            ))}
                                            {annotation.description && (
                                                <span className="text-sm text-black">— {annotation.description}</span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex gap-1 shrink-0">
                                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEditAnnotation(annotation)}>
                                            <Pencil className="h-3.5 w-3.5" />
                                        </Button>
                                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDeleteAnnotationClick(annotation)}>
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                </div>
                            ))}
                    </div>
                )}

            {/* Strategies Grid */}
            {loading ? (
                <div className="text-center py-12">
                    <p className="text-muted-foreground">載入中...</p>
                </div>
            ) : strategies.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground bg-secondary/10 rounded-lg border border-dashed">
                    尚無客戶資料
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {strategies
                        .filter(strategy => selectedUserId === 'all' || strategy.user_id === selectedUserId)
                        .filter(strategy => statusFilter === 'all' || strategy.status === statusFilter)
                        .filter(strategy => symbolFilter === 'all' || strategy.stocks.some(s => s.symbol === symbolFilter) || strategy.options.some(o => o.underlying === symbolFilter))
                        .map((strategy) => {
                            // Calculate total profit for sorting
                            const stockProfit = strategy.stocks.reduce((sum, stock) => {
                                if (stock.close_price && stock.open_price) {
                                    return sum + (stock.close_price - stock.open_price) * stock.quantity;
                                } else if (!stock.close_price && stock.current_market_price) {
                                    // Include unrealized P&L for open positions
                                    return sum + (stock.current_market_price - stock.open_price) * stock.quantity;
                                }
                                return sum;
                            }, 0);

                            const optionProfit = strategy.options.reduce((sum, option) => {
                                if (option.final_profit !== null && option.final_profit !== undefined) {
                                    return sum + option.final_profit;
                                }
                                return sum;
                            }, 0);

                            const totalProfit = stockProfit + optionProfit;

                            // Check for CC/PP mismatch
                            let hasMismatch = false;
                            if (strategy.option_strategy && strategy.status !== '已結案') {
                                const strats = strategy.option_strategy.split(',').map(s => s.trim());
                                const openStks = strategy.stocks.filter(s => s.status === 'Open' || (s as any).source === 'assigned');
                                const totalShares = openStks.reduce((sum, s) => sum + s.quantity, 0);
                                const expected = Math.floor(totalShares / 100);
                                if (strats.includes('Covered Call') && expected > 0) {
                                    const openCalls = strategy.options.filter(o => o.operation === 'Open' && o.type === 'CALL').reduce((sum, o) => sum + Math.abs(o.quantity), 0);
                                    if (openCalls < expected) hasMismatch = true;
                                }
                                if (strats.includes('Protective Put')) {
                                    const openPuts = strategy.options.filter(o => o.operation === 'Open' && o.type === 'PUT').reduce((sum, o) => sum + Math.abs(o.quantity), 0);
                                    if (totalShares === 0 && openPuts === 0) hasMismatch = true;
                                }
                            }

                            // Check for stock strategy alerts
                            if (strategy.stock_strategy && strategy.status !== '已結案') {
                                const stockStrats = strategy.stock_strategy.split(',').map(s => s.trim());
                                const openStocks = strategy.stocks.filter(s => s.status === 'Open' || (s as any).source === 'assigned');

                                if (stockStrats.includes('價差')) {
                                    const params = strategy.stock_strategy_params ? JSON.parse(strategy.stock_strategy_params) : {};
                                    const targetPct = params.spread_target_pct || 0;
                                    if (targetPct > 0) {
                                        for (const stock of openStocks) {
                                            if (stock.current_market_price && stock.open_price) {
                                                const gain = ((stock.current_market_price - stock.open_price) / stock.open_price) * 100;
                                                if (gain >= targetPct) hasMismatch = true;
                                            }
                                        }
                                    }
                                }

                                if (stockStrats.includes('不持股') && openStocks.length > 0 && totalProfit > 0) {
                                    hasMismatch = true;
                                }
                            }

                            return { ...strategy, totalProfit, hasMismatch };
                        })
                        .sort((a, b) => {
                            // Mismatch strategies always come first
                            if (a.hasMismatch !== b.hasMismatch) {
                                return a.hasMismatch ? -1 : 1;
                            }

                            if (sortOrder === 'date-new') {
                                // Sort by creation date (newest first)
                                return b.created_at - a.created_at;
                            } else if (sortOrder === 'date-old') {
                                // Sort by creation date (oldest first)
                                return a.created_at - b.created_at;
                            } else if (sortOrder === 'status-new') {
                                // First, sort by status: 進行中 comes before 已結案
                                const statusA = a.status === '進行中' ? 0 : 1;
                                const statusB = b.status === '進行中' ? 0 : 1;

                                if (statusA !== statusB) {
                                    return statusA - statusB;
                                }

                                // Then sort by creation date (newest first)
                                return b.created_at - a.created_at;
                            } else {
                                // status-old: First, sort by status: 進行中 comes before 已結案
                                const statusA = a.status === '進行中' ? 0 : 1;
                                const statusB = b.status === '進行中' ? 0 : 1;

                                if (statusA !== statusB) {
                                    return statusA - statusB;
                                }

                                // Then sort by creation date (oldest first)
                                return a.created_at - b.created_at;
                            }
                        })
                        .map((strategy) => {
                            return (
                                <Card key={strategy.id} className={`hover:shadow-lg transition-shadow p-0 gap-2 ${strategy.hasMismatch ? 'border-2 border-red-400' : ''}`}>
                                    <CardHeader className="px-4 pt-2 pb-0">
                                        {(() => {
                                            // Calculate total profit from stocks
                                            const stockProfit = strategy.stocks.reduce((sum, stock) => {
                                                if (stock.close_price && stock.open_price) {
                                                    return sum + (stock.close_price - stock.open_price) * stock.quantity;
                                                } else if (!stock.close_price && stock.current_market_price) {
                                                    // Include unrealized P&L for open positions
                                                    return sum + (stock.current_market_price - stock.open_price) * stock.quantity;
                                                }
                                                return sum;
                                            }, 0);

                                            // Calculate total profit from options
                                            const optionProfit = strategy.options.reduce((sum, option) => {
                                                if (option.final_profit !== null && option.final_profit !== undefined) {
                                                    return sum + option.final_profit;
                                                }
                                                return sum;
                                            }, 0);

                                            const totalProfit = stockProfit + optionProfit;

                                            // Calculate total margin
                                            const stockMargin = strategy.stocks
                                                .filter(s => s.status === 'Open' || (s as any).source === 'assigned')
                                                .reduce((sum, s) => sum + (s.open_price || 0) * s.quantity, 0);
                                            const optionMargin = strategy.options
                                                .filter(o => o.operation === 'Open' && o.type === 'PUT')
                                                .reduce((sum, o) => sum + ((o.strike_price || 0) * Math.abs(o.quantity) * 100), 0);
                                            const totalMargin = stockMargin + optionMargin;

                                            // Get user's net equity for margin percentage
                                            const userNetEquity = users.find(u => u.user_id === strategy.user_id)?.current_net_equity || 0;
                                            const marginPct = userNetEquity > 0 ? ((totalMargin / userNetEquity) * 100).toFixed(2) : '0.00';

                                            return (
                                                <div>
                                                    <div className="flex items-center justify-between">
                                                        <CardTitle className="flex items-center gap-2">
                                                            <span>
                                                                <span className="bg-gray-200 px-2 py-0.5 rounded text-sm cursor-pointer hover:bg-gray-300 transition-colors" onClick={(e) => { e.stopPropagation(); setSelectedUserId(strategy.user_id); }}>{strategy.user_id}</span>{strategy.status === '已結案' && (<span className="ml-1 mr-1 bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-sm font-normal">已結案</span>)}{(() => { const opts = strategy.option_strategy ? strategy.option_strategy.split(',').map(s => s.trim()) : []; const hasCC = opts.includes('Covered Call'); const hasPP = opts.includes('Protective Put'); if (hasCC && hasPP) { return <span className="ml-1 px-1.5 py-0.5 rounded text-xs font-semibold bg-green-100 text-green-800">Strangle</span>; } return opts.map((s, i) => (<span key={i} className={`ml-1 px-1.5 py-0.5 rounded text-xs font-semibold ${s === 'Covered Call' ? 'bg-emerald-100 text-emerald-800' : 'bg-violet-100 text-violet-800'}`}>{s === 'Covered Call' ? 'CC' : 'PP'}</span>)); })()}{strategy.stock_strategy && strategy.stock_strategy.split(',').map(s => s.trim()).map((s, i) => { const label = s === '價差' ? (() => { try { const params = strategy.stock_strategy_params ? JSON.parse(strategy.stock_strategy_params) : {}; return `價差${params.spread_target_pct || 10}%`; } catch { return '價差'; } })() : s; return (<span key={`ss-${i}`} className={`ml-1 px-1.5 py-0.5 rounded text-xs font-semibold ${s === '價差' ? 'bg-orange-100 text-orange-800' : 'bg-sky-100 text-sky-800'}`}>{label}</span>); })} {strategy.name}
                                                            </span>
                                                        </CardTitle>
                                                        <div className="flex gap-1">
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                onClick={() => handleEditStrategy(strategy)}
                                                            >
                                                                <Pencil className="h-4 w-4" />
                                                            </Button>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                onClick={() => handleDeleteClick(strategy)}
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </Button>
                                                        </div>
                                                    </div>
                                                    {/* CC/PP Mismatch Warning */}
                                                    {strategy.option_strategy && strategy.status !== '已結案' && (() => {
                                                        const strategies = strategy.option_strategy!.split(',').map(s => s.trim());
                                                        const openStocks = strategy.stocks.filter(s => s.status === 'Open' || (s as any).source === 'assigned');
                                                        const totalOpenShares = openStocks.reduce((sum, s) => sum + s.quantity, 0);
                                                        const expectedContracts = Math.floor(totalOpenShares / 100);
                                                        const stockSymbol = openStocks.length > 0 ? openStocks[0].symbol : '';
                                                        const warnings: string[] = [];

                                                        if (strategies.includes('Covered Call') && expectedContracts > 0) {
                                                            const openCalls = strategy.options
                                                                .filter(o => o.operation === 'Open' && o.type === 'CALL')
                                                                .reduce((sum, o) => sum + Math.abs(o.quantity), 0);
                                                            if (openCalls < expectedContracts) {
                                                                warnings.push(`持有 ${stockSymbol} ${totalOpenShares} 股，卻${openCalls === 0 ? '未持有' : `只持有 ${openCalls} 口`} ${expectedContracts} 口 SELL CALL！`);
                                                            }
                                                        }

                                                        if (strategies.includes('Protective Put')) {
                                                            const openPuts = strategy.options
                                                                .filter(o => o.operation === 'Open' && o.type === 'PUT')
                                                                .reduce((sum, o) => sum + Math.abs(o.quantity), 0);
                                                            if (totalOpenShares === 0 && openPuts === 0) {
                                                                warnings.push(`未持有正股，也未持有 SELL PUT！`);
                                                            }
                                                        }

                                                        if (warnings.length === 0) return null;
                                                        return (
                                                            <div className="mt-1 space-y-0.5">
                                                                {warnings.map((w, i) => (
                                                                    <div key={i} className="text-sm bg-amber-100 text-amber-900 px-2 py-1 rounded font-medium flex items-center gap-1">
                                                                        <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" /> {w}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        );
                                                    })()}
                                                    {/* Stock Strategy Alerts */}
                                                    {strategy.stock_strategy && strategy.status !== '已結案' && (() => {
                                                        const stockStrats = strategy.stock_strategy!.split(',').map(s => s.trim());
                                                        const openStocks = strategy.stocks.filter(s => s.status === 'Open' || (s as any).source === 'assigned');
                                                        const warnings: string[] = [];

                                                        if (stockStrats.includes('價差')) {
                                                            const params = strategy.stock_strategy_params ? JSON.parse(strategy.stock_strategy_params) : {};
                                                            const targetPct = params.spread_target_pct || 0;
                                                            if (targetPct > 0) {
                                                                for (const stock of openStocks) {
                                                                    if (stock.current_market_price && stock.open_price) {
                                                                        const gain = ((stock.current_market_price - stock.open_price) / stock.open_price) * 100;
                                                                        if (gain >= targetPct) {
                                                                            warnings.push(`${stock.symbol} 已漲 ${gain.toFixed(1)}%，超過目標 ${targetPct}%！`);
                                                                        }
                                                                    }
                                                                }
                                                            }
                                                        }

                                                        if (stockStrats.includes('不持股') && openStocks.length > 0) {
                                                            // Calculate total strategy profit
                                                            const stkProfit = strategy.stocks.reduce((sum, stock) => {
                                                                if (stock.close_price && stock.open_price) return sum + (stock.close_price - stock.open_price) * stock.quantity;
                                                                if (!stock.close_price && stock.current_market_price) return sum + (stock.current_market_price - stock.open_price) * stock.quantity;
                                                                return sum;
                                                            }, 0);
                                                            const optProfit = strategy.options.reduce((sum, o) => sum + (o.final_profit || 0), 0);
                                                            const total = stkProfit + optProfit;
                                                            if (total > 0) {
                                                                warnings.push(`策略盈利中 (+${Math.round(total).toLocaleString()})，但仍持有正股！`);
                                                            }
                                                        }

                                                        if (warnings.length === 0) return null;
                                                        return (
                                                            <div className="mt-1 space-y-0.5">
                                                                {warnings.map((w, i) => (
                                                                    <div key={i} className="text-sm bg-amber-100 text-amber-900 px-2 py-1 rounded font-medium flex items-center gap-1">
                                                                        <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" /> {w}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        );
                                                    })()}
                                                    <div className="flex items-center gap-1 mt-3 text-sm">
                                                        <span>{strategy.status === '已結案' ? '最終收益' : '當前收益'} <span className={`font-semibold ${totalProfit >= 0 ? 'text-green-700' : 'text-red-600'}`}>{Math.round(totalProfit).toLocaleString()}</span></span>
                                                        {totalMargin > 0 && <span>, 資金需求 {Math.round(totalMargin).toLocaleString()}{parseFloat(marginPct) > 0 && ` (${marginPct}%)`}</span>}
                                                    </div>
                                                    {(() => {
                                                        // Calculate adjusted cost basis: stock open_price reduced by option profits
                                                        const openStocks = strategy.stocks.filter(s => s.status === 'Open' || (s as any).source === 'assigned');
                                                        const totalOpenQty = openStocks.reduce((sum, s) => sum + s.quantity, 0);
                                                        if (totalOpenQty === 0) return null;

                                                        const optProfit = strategy.options.reduce((sum, o) => {
                                                            if (o.final_profit !== null && o.final_profit !== undefined) {
                                                                return sum + o.final_profit;
                                                            }
                                                            return sum;
                                                        }, 0);

                                                        // Weighted average open price
                                                        const weightedCost = openStocks.reduce((sum, s) => sum + (s.open_price || 0) * s.quantity, 0) / totalOpenQty;
                                                        const adjustedCost = weightedCost - (optProfit / totalOpenQty);

                                                        return (
                                                            <div className="text-sm mt-0.5">
                                                                {openStocks[0].symbol} 成本 {weightedCost.toFixed(2)} → 調整後成本 <span className="font-semibold text-foreground">{adjustedCost.toFixed(2)}</span>
                                                            </div>
                                                        );
                                                    })()}
                                                </div>
                                            );
                                        })()}
                                    </CardHeader>
                                    <CardContent className="px-4 space-y-3 pt-0 pb-3">
                                        {/* Stock Trades Table */}
                                        {strategy.stocks.length > 0 && (() => {
                                            const stockProfit = strategy.stocks.reduce((sum, stock) => {
                                                if (stock.close_price && stock.open_price) {
                                                    return sum + (stock.close_price - stock.open_price) * stock.quantity;
                                                } else if (!stock.close_price && stock.current_market_price) {
                                                    // Include unrealized P&L for open positions
                                                    return sum + (stock.current_market_price - stock.open_price) * stock.quantity;
                                                }
                                                return sum;
                                            }, 0);

                                            return (
                                                <div className="space-y-1">
                                                    <div className="text-sm font-medium bg-red-50 px-3 py-1.5 rounded flex items-center justify-between">
                                                        <span>{strategy.stocks.length} 筆股票, 收益 <span className={stockProfit >= 0 ? 'text-green-700' : 'text-red-600'}>{Math.round(stockProfit).toLocaleString()}</span></span>
                                                        <div className="flex items-center gap-2">
                                                            {(() => { const m = Math.round(strategy.stocks.filter(s => s.status === 'Open' || (s as any).source === 'assigned').reduce((sum, s) => sum + (s.open_price || 0) * s.quantity, 0)); return m > 0 ? <span className="text-xs text-muted-foreground">資金需求 {m.toLocaleString()}</span> : null; })()}
                                                            {(() => {
                                                                const symbols = [...new Set(strategy.stocks.map(s => s.symbol))];
                                                                if (symbols.length <= 1) return null;
                                                                return (
                                                                    <select
                                                                        className="text-xs bg-white border rounded px-1.5 py-0.5 ml-2"
                                                                        value={stockSymbolFilters[strategy.id] || 'all'}
                                                                        onChange={e => setStockSymbolFilters(prev => ({ ...prev, [strategy.id]: e.target.value }))}
                                                                        onClick={e => e.stopPropagation()}
                                                                    >
                                                                        <option value="all">全部標的</option>
                                                                        {symbols.map(s => <option key={s} value={s}>{s}</option>)}
                                                                    </select>
                                                                );
                                                            })()}
                                                        </div>
                                                    </div>
                                                    <div className="overflow-x-auto max-h-[170px] overflow-y-auto">
                                                        <table className="w-full table-auto text-xs">
                                                            <thead>
                                                                <tr className="border-b">
                                                                    <th className="text-center py-1 px-2 font-medium text-muted-foreground">狀態</th>
                                                                    <th className="text-center py-1 px-2 font-medium text-muted-foreground">標的</th>
                                                                    <th className="text-center py-1 px-2 font-medium text-muted-foreground">股數</th>
                                                                    <th className="text-center py-1 px-2 font-medium text-muted-foreground">開倉價</th>
                                                                    <th className="text-center py-1 px-2 font-medium text-muted-foreground">開倉日</th>
                                                                    <th className="text-center py-1 px-2 font-medium text-muted-foreground">平倉日</th>
                                                                    <th className="text-center py-1 px-2 font-medium text-muted-foreground">盈虧</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {strategy.stocks.sort((a, b) => b.open_date - a.open_date).filter(stock => {
                                                                    const filter = stockSymbolFilters[strategy.id] || 'all';
                                                                    return filter === 'all' || stock.symbol === filter;
                                                                }).map(stock => {
                                                                    const openDate = new Date(stock.open_date * 1000);
                                                                    const formattedDate = `${String(openDate.getMonth() + 1).padStart(2, '0')}/${String(openDate.getDate()).padStart(2, '0')}`;

                                                                    let formattedCloseDate = '-';
                                                                    if (stock.close_date) {
                                                                        const closeDate = new Date(stock.close_date * 1000);
                                                                        formattedCloseDate = `${String(closeDate.getMonth() + 1).padStart(2, '0')}/${String(closeDate.getDate()).padStart(2, '0')}`;
                                                                    }

                                                                    let profit: number | null = null;
                                                                    console.log(`💹 Calculating P&L for ${stock.symbol}:`, {
                                                                        close_price: stock.close_price,
                                                                        current_market_price: stock.current_market_price,
                                                                        open_price: stock.open_price,
                                                                        quantity: stock.quantity
                                                                    });
                                                                    if (stock.close_price) {
                                                                        // Realized P&L for closed positions
                                                                        profit = Math.round((stock.close_price - stock.open_price) * stock.quantity * 100) / 100;
                                                                    } else if (stock.current_market_price) {
                                                                        // Unrealized P&L for open positions using current market price
                                                                        profit = Math.round((stock.current_market_price - stock.open_price) * stock.quantity * 100) / 100;
                                                                        console.log(`✅ Calculated unrealized P&L for ${stock.symbol}:`, profit);
                                                                    } else {
                                                                        console.warn(`⚠️ No market price found for ${stock.symbol}`);
                                                                    }

                                                                    return (
                                                                        <tr key={stock.id} className={`border-b last:border-0 ${!stock.close_date ? 'bg-gray-100' : ''}`}>
                                                                            <td className={`py-1 px-2 text-gray-900 text-center ${!stock.close_date ? 'bg-pink-50' : ''}`}>{stock.close_date ? 'Closed' : (stock.source === 'assigned' ? <span className="font-bold">Assigned</span> : <span className="font-bold">Open</span>)}</td>
                                                                            <td className="py-1 px-2 text-gray-900 text-center">{stock.symbol}</td>
                                                                            <td className="py-1 px-2 text-gray-900 text-center">{stock.quantity}</td>
                                                                            <td className="py-1 px-2 text-gray-900 text-center">{stock.open_price?.toFixed(2) || '-'}</td>
                                                                            <td className="py-1 px-2 text-gray-900 text-center">{formattedDate}</td>
                                                                            <td className="py-1 px-2 text-gray-900 text-center">{formattedCloseDate}</td>
                                                                            <td className="py-1 px-2 text-center">
                                                                                {profit !== null ? (
                                                                                    <span className={`font-medium ${profit >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                                                                                        {Math.round(profit).toLocaleString('en-US')}
                                                                                    </span>
                                                                                ) : (
                                                                                    <span className="text-muted-foreground">-</span>
                                                                                )}
                                                                            </td>
                                                                        </tr>
                                                                    );
                                                                })}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </div>
                                            );
                                        })()}

                                        {/* Options Table */}
                                        {strategy.options.length > 0 && (() => {
                                            const optionProfit = strategy.options.reduce((sum, option) => {
                                                if (option.final_profit !== null && option.final_profit !== undefined) {
                                                    return sum + option.final_profit;
                                                }
                                                return sum;
                                            }, 0);

                                            return (
                                                <div className="space-y-1">
                                                    <div className="text-sm font-medium bg-red-50 px-3 py-1.5 rounded flex items-center justify-between">
                                                        <span>{strategy.options.length} 筆期權, 收益 <span className={optionProfit >= 0 ? 'text-green-700' : 'text-red-600'}>{Math.round(optionProfit).toLocaleString()}</span></span>
                                                        <div className="flex items-center gap-2">
                                                            {(() => { const m = Math.round(strategy.options.filter(o => o.operation === 'Open' && o.type === 'PUT').reduce((sum, o) => sum + ((o.strike_price || 0) * Math.abs(o.quantity) * 100), 0)); return m > 0 ? <span className="text-xs text-muted-foreground">資金需求 {m.toLocaleString()}</span> : null; })()}
                                                            {(() => {
                                                                const symbols = [...new Set(strategy.options.map(o => o.underlying))];
                                                                if (symbols.length <= 1) return null;
                                                                return (
                                                                    <select
                                                                        className="text-xs bg-white border rounded px-1.5 py-0.5 ml-2"
                                                                        value={optionSymbolFilters[strategy.id] || 'all'}
                                                                        onChange={e => setOptionSymbolFilters(prev => ({ ...prev, [strategy.id]: e.target.value }))}
                                                                        onClick={e => e.stopPropagation()}
                                                                    >
                                                                        <option value="all">全部標的</option>
                                                                        {symbols.map(s => <option key={s} value={s}>{s}</option>)}
                                                                    </select>
                                                                );
                                                            })()}
                                                        </div>
                                                    </div>
                                                    <div className="overflow-x-auto max-h-[170px] overflow-y-auto">
                                                        <table className="w-full table-auto text-xs">
                                                            <thead>
                                                                <tr className="border-b">
                                                                    <th className="text-center py-1 px-2 font-medium text-muted-foreground">操作</th>
                                                                    <th className="text-center py-1 px-2 font-medium text-muted-foreground">標的</th>
                                                                    <th className="text-center py-1 px-2 font-medium text-muted-foreground">口數</th>
                                                                    <th className="text-center py-1 px-2 font-medium text-muted-foreground">開倉日</th>
                                                                    <th className="text-center py-1 px-2 font-medium text-muted-foreground">平倉日</th>
                                                                    <th className="text-center py-1 px-2 font-medium text-muted-foreground">盈虧</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {strategy.options.sort((a, b) => b.open_date - a.open_date).filter(option => {
                                                                    const filter = optionSymbolFilters[strategy.id] || 'all';
                                                                    return filter === 'all' || option.underlying === filter;
                                                                }).map(option => {
                                                                    const openDate = new Date(option.open_date * 1000);
                                                                    const formattedOpenDate = `${String(openDate.getMonth() + 1).padStart(2, '0')}/${String(openDate.getDate()).padStart(2, '0')}`;

                                                                    // Format expiry date (MM-DD) for label
                                                                    let expiryLabel = '';
                                                                    if (option.to_date) {
                                                                        const toDate = new Date(option.to_date * 1000);
                                                                        expiryLabel = `${String(toDate.getMonth() + 1).padStart(2, '0')}/${String(toDate.getDate()).padStart(2, '0')}`;
                                                                    }

                                                                    // Format settlement date (平倉日)
                                                                    let formattedSettlement = '-';
                                                                    if (option.settlement_date) {
                                                                        const sDate = new Date(option.settlement_date * 1000);
                                                                        formattedSettlement = `${String(sDate.getMonth() + 1).padStart(2, '0')}/${String(sDate.getDate()).padStart(2, '0')}`;
                                                                    }

                                                                    // Full option label: QQQ_615_C_02-10
                                                                    const typeShort = option.type === 'CALL' ? 'C' : 'P';
                                                                    const optionLabel = `${option.underlying}_${option.strike_price || ''}_${typeShort}${expiryLabel ? '_' + expiryLabel : ''}`;

                                                                    return (
                                                                        <tr key={option.id} className={`border-b last:border-0 ${option.operation === 'Open' ? 'bg-gray-100' : ''}`}>
                                                                            <td className={`py-1 px-2 text-gray-900 text-center ${option.operation === 'Open' ? 'bg-pink-50' : ''}`}>{option.operation === 'Closed' ? option.operation : <span className="font-bold">{option.operation}</span>}</td>
                                                                            <td className="py-1 px-2 text-gray-900 text-center">{optionLabel}</td>
                                                                            <td className="py-1 px-2 text-gray-900 text-center">{option.quantity}</td>
                                                                            <td className="py-1 px-2 text-gray-900 text-center">{formattedOpenDate}</td>
                                                                            <td className="py-1 px-2 text-gray-900 text-center">{formattedSettlement}</td>
                                                                            <td className="py-1 px-2 text-center">
                                                                                {option.final_profit !== null && option.final_profit !== undefined ? (
                                                                                    <span className={`font-medium ${option.final_profit >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                                                                                        {Math.round(option.final_profit).toLocaleString('en-US')}
                                                                                    </span>
                                                                                ) : (
                                                                                    <span className="text-muted-foreground">-</span>
                                                                                )}
                                                                            </td>
                                                                        </tr>
                                                                    );
                                                                })}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </div>
                                            );
                                        })()}

                                        {/* Empty state */}
                                        {strategy.stocks.length === 0 && strategy.options.length === 0 && (
                                            <p className="text-sm text-muted-foreground text-center py-2">
                                                尚未添加任何交易
                                            </p>
                                        )}
                                    </CardContent>
                                </Card>
                            );
                        })}
                </div>
            )
            }

            {/* Strategy Dialog */}
            < StrategyDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                strategy={selectedStrategy}
                onSave={refreshStrategiesSilently}
                currentYear={selectedYear}
            />

            {/* Annotation Dialog */}
            < AnnotationDialog
                open={annotationDialogOpen}
                onOpenChange={setAnnotationDialogOpen}
                annotation={selectedAnnotation}
                onSave={fetchAnnotations}
                currentYear={selectedYear}
            />

            {/* Delete Confirmation Dialog */}
            < AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen} >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>確認刪除</AlertDialogTitle>
                        <AlertDialogDescription>
                            您確定要刪除策略「{strategyToDelete?.name}」嗎？此操作無法復原。
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDeleteConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            刪除
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Delete Annotation Confirmation Dialog */}
            <AlertDialog open={deleteAnnotationDialogOpen} onOpenChange={setDeleteAnnotationDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>確認刪除</AlertDialogTitle>
                        <AlertDialogDescription>
                            您確定要刪除此筆註解嗎？此操作無法復原。
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDeleteAnnotationConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            刪除
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
