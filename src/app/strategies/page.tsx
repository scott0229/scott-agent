'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Target, Plus, Pencil, Trash2, TrendingUp } from 'lucide-react';
import { StrategyDialog } from '@/components/StrategyDialog';
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
}

interface Option {
    id: number;
    underlying: string;
    operation: string;
    user_id: string;
    code: string;
    final_profit?: number | null;
    quantity: number;
    open_date: number;
    to_date?: number | null;
}

interface Strategy {
    id: number;
    name: string;
    user_id: string;
    owner_id: number;
    year: number;
    stocks: StockTrade[];
    options: Option[];
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

    useEffect(() => {
        fetchStrategies();
    }, [selectedYear]);

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
                <h1 className="text-3xl font-bold flex items-center gap-2">
                    <Target className="h-8 w-8" />
                    投資策略
                </h1>
                <Button onClick={handleAddStrategy} variant="secondary" className="gap-2">
                    <Plus className="h-4 w-4" />
                    新增
                </Button>
            </div>

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
                    {strategies.map((strategy) => (
                        <Card key={strategy.id} className="hover:shadow-lg transition-shadow p-0">
                            <CardHeader className="px-4 pb-0 pt-1">
                                {(() => {
                                    // Calculate total profit from stocks
                                    const stockProfit = strategy.stocks.reduce((sum, stock) => {
                                        if (stock.close_price && stock.open_price) {
                                            return sum + (stock.close_price - stock.open_price) * stock.quantity;
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

                                    return (
                                        <div className="flex items-center justify-between">
                                            <CardTitle className="flex items-center gap-2">
                                                <Target className="h-5 w-5" />
                                                <span>
                                                    ({strategy.user_id}) {strategy.name}, 當前收益 <span className={totalProfit >= 0 ? 'text-green-600' : 'text-red-600'}>{Math.round(totalProfit).toLocaleString()}</span>
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
                                    );
                                })()}
                            </CardHeader>
                            <CardContent className="px-4 space-y-2 pt-0 pb-3">
                                {/* Stock Trades Table */}
                                {strategy.stocks.length > 0 && (
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-2 text-sm font-medium">
                                            <svg
                                                xmlns="http://www.w3.org/2000/svg"
                                                width="16"
                                                height="16"
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="2"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                            >
                                                <path d="M3 3v18h18" />
                                                <path d="m19 9-5 5-4-4-3 3" />
                                            </svg>
                                            股票交易: {strategy.stocks.length} 筆
                                        </div>
                                        <div className="overflow-x-auto max-h-[170px] overflow-y-auto">
                                            <table className="w-full table-fixed text-xs">
                                                <thead>
                                                    <tr className="border-b">
                                                        <th className="text-center py-1 px-2 font-medium text-muted-foreground w-14">代碼</th>
                                                        <th className="text-center py-1 px-2 font-medium text-muted-foreground w-16">標的</th>
                                                        <th className="text-center py-1 px-2 font-medium text-muted-foreground w-10">股數</th>
                                                        <th className="text-center py-1 px-2 font-medium text-muted-foreground w-20">開倉日</th>
                                                        <th className="text-center py-1 px-2 font-medium text-muted-foreground w-20">平倉日</th>
                                                        <th className="text-center py-1 px-2 font-medium text-muted-foreground w-16">損益</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {strategy.stocks.sort((a, b) => b.open_date - a.open_date).map(stock => {
                                                        const openDate = new Date(stock.open_date * 1000);
                                                        const formattedDate = `${String(openDate.getFullYear()).slice(-2)}-${String(openDate.getMonth() + 1).padStart(2, '0')}-${String(openDate.getDate()).padStart(2, '0')}`;

                                                        let formattedCloseDate = '-';
                                                        if (stock.close_date) {
                                                            const closeDate = new Date(stock.close_date * 1000);
                                                            formattedCloseDate = `${String(closeDate.getFullYear()).slice(-2)}-${String(closeDate.getMonth() + 1).padStart(2, '0')}-${String(closeDate.getDate()).padStart(2, '0')}`;
                                                        }

                                                        let profit: number | null = null;
                                                        if (stock.close_price) {
                                                            profit = (stock.close_price - stock.open_price) * stock.quantity;
                                                        }

                                                        return (
                                                            <tr key={stock.id} className="border-b last:border-0">
                                                                <td className="py-1 px-2 text-gray-900 text-center w-14">{stock.code}</td>
                                                                <td className="py-1 px-2 text-gray-900 text-center w-16">{stock.symbol}</td>
                                                                <td className="py-1 px-2 text-gray-900 text-center w-10">{stock.quantity}</td>
                                                                <td className="py-1 px-2 text-gray-900 text-center w-20">{formattedDate}</td>
                                                                <td className="py-1 px-2 text-gray-900 text-center w-20">{formattedCloseDate}</td>
                                                                <td className="py-1 px-2 text-center w-16">
                                                                    {profit !== null ? (
                                                                        <span className={`font-medium ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                                            {profit >= 0 ? '+' : ''}{profit.toFixed(2)}
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
                                )}

                                {/* Options Table */}
                                {strategy.options.length > 0 && (
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-2 text-sm font-medium">
                                            <TrendingUp className="h-4 w-4" />
                                            期權交易: {strategy.options.length} 筆
                                        </div>
                                        <div className="overflow-x-auto max-h-[170px] overflow-y-auto">
                                            <table className="w-full table-fixed text-xs">
                                                <thead>
                                                    <tr className="border-b">
                                                        <th className="text-center py-1 px-2 font-medium text-muted-foreground w-14">代碼</th>
                                                        <th className="text-center py-1 px-2 font-medium text-muted-foreground w-16">標的</th>
                                                        <th className="text-center py-1 px-2 font-medium text-muted-foreground w-10">口數</th>
                                                        <th className="text-center py-1 px-2 font-medium text-muted-foreground w-20">開倉日</th>
                                                        <th className="text-center py-1 px-2 font-medium text-muted-foreground w-20">到期日</th>
                                                        <th className="text-center py-1 px-2 font-medium text-muted-foreground w-16">損益</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {strategy.options.sort((a, b) => b.open_date - a.open_date).map(option => {
                                                        const openDate = new Date(option.open_date * 1000);
                                                        const formattedOpenDate = `${String(openDate.getFullYear()).slice(-2)}-${String(openDate.getMonth() + 1).padStart(2, '0')}-${String(openDate.getDate()).padStart(2, '0')}`;

                                                        let formattedToDate = '-';
                                                        if (option.to_date) {
                                                            const toDate = new Date(option.to_date * 1000);
                                                            formattedToDate = `${String(toDate.getFullYear()).slice(-2)}-${String(toDate.getMonth() + 1).padStart(2, '0')}-${String(toDate.getDate()).padStart(2, '0')}`;
                                                        }

                                                        return (
                                                            <tr key={option.id} className="border-b last:border-0">
                                                                <td className="py-1 px-2 text-gray-900 text-center w-14">{option.code}</td>
                                                                <td className="py-1 px-2 text-gray-900 text-center w-16">{option.underlying}</td>
                                                                <td className="py-1 px-2 text-gray-900 text-center w-10">{option.quantity}</td>
                                                                <td className="py-1 px-2 text-gray-900 text-center w-20">{formattedOpenDate}</td>
                                                                <td className="py-1 px-2 text-gray-900 text-center w-20">{formattedToDate}</td>
                                                                <td className="py-1 px-2 text-center w-16">
                                                                    {option.final_profit !== null && option.final_profit !== undefined ? (
                                                                        <span className={`font-medium ${option.final_profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                                            {option.final_profit >= 0 ? '+' : ''}{option.final_profit.toFixed(2)}
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
                                )}

                                {/* Empty state */}
                                {strategy.stocks.length === 0 && strategy.options.length === 0 && (
                                    <p className="text-sm text-muted-foreground text-center py-2">
                                        尚未添加任何交易
                                    </p>
                                )}
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            {/* Strategy Dialog */}
            <StrategyDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                strategy={selectedStrategy}
                onSave={fetchStrategies}
                currentYear={selectedYear}
            />

            {/* Delete Confirmation Dialog */}
            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
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
        </div>
    );
}
