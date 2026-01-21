'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useYearFilter } from '@/contexts/YearFilterContext';
import { SetInitialCostDialog } from '@/components/SetInitialCostDialog';
import { NetEquityChart } from '@/components/NetEquityChart';

import { Pencil, BarChart3, Coins, Plus } from "lucide-react";

interface UserSummary {
    id: number;
    user_id: string;
    email: string;
    initial_cost: number;
    current_net_equity: number;
    current_cash_balance?: number;
    total_deposit?: number;
    stats: {
        startDate: number;
        returnPercentage: number;
        maxDrawdown: number;
        annualizedReturn: number;
        annualizedStdDev: number;
        sharpeRatio: number;
        newHighCount: number;
        newHighFreq: number;
    } | null;
    monthly_stats?: {
        month: number;
        net_equity: number;
        profit: number;
        return_rate: number;
    }[];

    equity_history?: {
        date: number;
        net_equity: number;
    }[];
    qqqStats?: {
        startEquity: number;
        currentEquity: number;
        returnPercentage: number;
        maxDrawdown: number;
        annualizedReturn: number;
        annualizedStdDev: number;
        sharpeRatio: number;
        newHighCount: number;
        newHighFreq: number;
    } | null;
    qldStats?: {
        startEquity: number;
        currentEquity: number;
        returnPercentage: number;
        maxDrawdown: number;
        annualizedReturn: number;
        annualizedStdDev: number;
        sharpeRatio: number;
        newHighCount: number;
        newHighFreq: number;
    } | null;
}

export default function NetEquityPage() {
    const [summaries, setSummaries] = useState<UserSummary[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [role, setRole] = useState<string | null>(null);
    const { selectedYear } = useYearFilter(); // Get year context
    const router = useRouter();
    const [editCostDialog, setEditCostDialog] = useState<{ open: boolean; userId: number; currentCost: number } | null>(null);
    const [sortOrder, setSortOrder] = useState('net-equity-desc');

    useEffect(() => {
        fetchData();
    }, [selectedYear]); // Refresh when year changes

    const fetchData = async () => {
        try {
            // Check auth first
            const authRes = await fetch('/api/auth/me');
            if (authRes.ok) {
                const authData = await authRes.json();
                if (authData.user) {
                    setRole(authData.user.role);
                    if (authData.user.role === 'customer') {
                        router.push(`/net-equity/${authData.user.id}`);
                        return;
                    }
                }
            }

            // Fetch summaries (Admin/Manager) with Year
            const yearParam = selectedYear === 'All' ? '' : `?year=${selectedYear}`;
            const res = await fetch(`/api/net-equity${yearParam}`);
            const data = await res.json();
            if (data.success) {
                setSummaries(data.data);
            }
        } catch (error) {
            console.error('Failed to fetch data:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const formatDate = (timestamp: number) => {
        const date = new Date(timestamp * 1000);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    };

    const formatPercent = (val: number) => {
        return `${(val * 100).toFixed(2)}%`;
    };

    const formatMoney = (val: number) => {
        return new Intl.NumberFormat('en-US').format(Math.round(val));
    };

    if (isLoading) {
        return (
            <div className="flex h-screen items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    // Customer redirect happens in useEffect, so we might render null effectively or loading state
    if (role === 'customer') {
        return null;
    }

    const StatBadge = ({ value, variant = 'return', format }: { value: number, variant?: 'return' | 'drawdown' | 'sharpe', format?: (v: number) => string }) => {
        const isPositive = value >= 0;
        const isNegative = value < 0;

        let colorClass = "bg-gray-100 text-gray-600 border-gray-200";

        if (variant === 'drawdown') {
            colorClass = "bg-orange-50 text-orange-600 border-orange-200";
        } else if (variant === 'sharpe') {
            colorClass = "bg-blue-50 text-blue-600 border-blue-200";
        } else {
            // Return logic
            if (isPositive) {
                colorClass = "bg-emerald-50 text-emerald-600 border-emerald-200";
            } else if (isNegative) {
                colorClass = "bg-red-50 text-red-600 border-red-200";
            }
        }

        return (
            <span className={`inline-flex items-center justify-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${colorClass}`}>
                {format ? format(value) : formatPercent(value)}
            </span>
        );
    };

    return (
        <div className="container mx-auto py-10 max-w-[1400px]">
            <div className="mb-8 flex justify-between items-center">
                <h1 className="text-3xl font-bold">
                    {selectedYear === 'All' ? new Date().getFullYear() : selectedYear} 績效總覽
                </h1>
                <Select value={sortOrder} onValueChange={setSortOrder}>
                    <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="排序方式" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="alphabetical">按字母</SelectItem>
                        <SelectItem value="net-equity-desc">當前淨值-從大到小</SelectItem>
                        <SelectItem value="return-desc">報酬率-從大到小</SelectItem>
                        <SelectItem value="drawdown-desc">最大回撤-從大到小</SelectItem>
                        <SelectItem value="sharpe-desc">夏普值-從大到小</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <div className="grid grid-cols-1 gap-4">
                {[...summaries].sort((a, b) => {
                    if (sortOrder === 'alphabetical') {
                        const nameA = a.user_id || a.email;
                        const nameB = b.user_id || b.email;
                        return nameA.localeCompare(nameB);
                    }
                    if (sortOrder === 'net-equity-desc') {
                        return (b.current_net_equity || 0) - (a.current_net_equity || 0);
                    }
                    if (sortOrder === 'return-desc') {
                        return (b.stats?.returnPercentage || 0) - (a.stats?.returnPercentage || 0);
                    }
                    if (sortOrder === 'drawdown-desc') {
                        return (b.stats?.maxDrawdown || 0) - (a.stats?.maxDrawdown || 0);
                    }
                    if (sortOrder === 'sharpe-desc') {
                        return (b.stats?.sharpeRatio || 0) - (a.stats?.sharpeRatio || 0);
                    }
                    return 0;
                }).map((user) => (
                    <Card
                        key={user.id}
                        className="hover:shadow-lg transition-all hover:border-primary/50 cursor-pointer py-0"
                        onClick={() => router.push(`/net-equity/${user.id}`)}
                    >
                        <CardContent className="p-4">
                            <div className="grid grid-cols-[45%_1fr] gap-4">
                                {/* Stats Table */}
                                <div className="border rounded-md overflow-hidden">
                                    <table className="w-full text-[13px]">
                                        <thead>
                                            <tr className="border-b bg-muted/40 text-[13px] font-medium">
                                                <td className="py-2 px-2 w-[25%]"></td>
                                                <td className="py-1 px-2 text-center font-bold w-[25%]">
                                                    <div
                                                        className="inline-flex items-center justify-center gap-1.5 cursor-pointer rounded-md px-2 py-0.5 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            router.push(`/net-equity/${user.id}`);
                                                        }}
                                                    >
                                                        <div className="h-2 w-2 rounded-full bg-[#2563eb]" />
                                                        <span>{user.user_id || 'scott'}</span>
                                                    </div>
                                                </td>
                                                <td className="py-1 px-2 text-center font-bold w-[25%]">
                                                    <div
                                                        className="inline-flex items-center justify-center gap-1.5 cursor-pointer rounded-md px-2 py-0.5 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            router.push(`/net-equity/${user.id}/benchmark/QQQ`);
                                                        }}
                                                    >
                                                        <div className="h-2 w-2 rounded-full bg-[#22c55e]" />
                                                        <span>QQQ</span>
                                                    </div>
                                                </td>
                                                <td className="py-1 px-2 text-center font-bold w-[25%]">
                                                    <div
                                                        className="inline-flex items-center justify-center gap-1.5 cursor-pointer rounded-md px-2 py-0.5 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            router.push(`/net-equity/${user.id}/benchmark/QLD`);
                                                        }}
                                                    >
                                                        <div className="h-2 w-2 rounded-full bg-[#f97316]" />
                                                        <span>QLD</span>
                                                    </div>
                                                </td>
                                            </tr>
                                        </thead>
                                        <tbody className="text-[13px]">
                                            <tr className="border-t hover:bg-secondary/20 bg-white">
                                                <td className="h-7 py-1 px-2">當前淨值</td>
                                                <td className="h-7 py-1 px-2 text-center">
                                                    {formatMoney(user.current_net_equity || 0)}
                                                </td>
                                                <td className="h-7 py-1 px-2 text-center">
                                                    {user.qqqStats ? formatMoney(user.qqqStats.currentEquity) : '-'}
                                                </td>
                                                <td className="h-7 py-1 px-2 text-center">
                                                    {user.qldStats ? formatMoney(user.qldStats.currentEquity) : '-'}
                                                </td>
                                            </tr>
                                            <tr className="border-t hover:bg-secondary/20 bg-slate-50/50">
                                                <td className="h-7 py-1 px-2">年初淨值</td>
                                                <td className="h-7 py-1 px-2 text-center">
                                                    {formatMoney(user.initial_cost || 0)}
                                                </td>
                                                <td className="h-7 py-1 px-2 text-center">
                                                    {user.qqqStats ? formatMoney(user.qqqStats.startEquity) : '-'}
                                                </td>
                                                <td className="h-7 py-1 px-2 text-center">
                                                    {user.qldStats ? formatMoney(user.qldStats.startEquity) : '-'}
                                                </td>
                                            </tr>
                                            <tr className="border-t hover:bg-secondary/20 bg-white">
                                                <td className="h-7 py-1 px-2">轉帳記錄</td>
                                                <td className="h-7 py-1 px-2 text-center">
                                                    {user.total_deposit !== undefined && user.total_deposit !== 0 ? (user.total_deposit > 0 ? formatMoney(user.total_deposit) : <span className="text-red-600">{formatMoney(user.total_deposit)}</span>) : '0'}
                                                </td>
                                                <td className="h-7 py-1 px-2 text-center">
                                                    {user.qqqStats ? ((user.total_deposit || 0) > 0 ? formatMoney(user.total_deposit || 0) : <span className="text-red-600">{formatMoney(user.total_deposit || 0)}</span>) : '-'}
                                                </td>
                                                <td className="h-7 py-1 px-2 text-center">
                                                    {user.qldStats ? ((user.total_deposit || 0) > 0 ? formatMoney(user.total_deposit || 0) : <span className="text-red-600">{formatMoney(user.total_deposit || 0)}</span>) : '-'}
                                                </td>
                                            </tr>
                                            <tr className="border-t hover:bg-secondary/20 bg-slate-50/50">
                                                <td className="h-7 py-1 px-2">淨利潤</td>
                                                <td className="h-7 py-1 px-2 text-center">
                                                    {formatMoney((user.current_net_equity || 0) - (user.initial_cost || 0) - (user.total_deposit || 0))}
                                                </td>
                                                <td className="h-7 py-1 px-2 text-center">
                                                    {user.qqqStats ? formatMoney(user.qqqStats.currentEquity - user.qqqStats.startEquity - (user.total_deposit || 0)) : '-'}
                                                </td>
                                                <td className="h-7 py-1 px-2 text-center">
                                                    {user.qldStats ? formatMoney(user.qldStats.currentEquity - user.qldStats.startEquity - (user.total_deposit || 0)) : '-'}
                                                </td>
                                            </tr>
                                            <tr className="border-t hover:bg-secondary/20 bg-white">
                                                <td className="h-7 py-1 px-2">帳戶現金</td>
                                                <td className="h-7 py-1 px-2 text-center">
                                                    {user.current_cash_balance !== undefined ? formatMoney(user.current_cash_balance) : '0'}
                                                </td>
                                                <td className="h-7 py-1 px-2 text-center">
                                                    0
                                                </td>
                                                <td className="h-7 py-1 px-2 text-center">
                                                    0
                                                </td>
                                            </tr>
                                            <tr className="border-t hover:bg-secondary/20 bg-slate-50/50">
                                                <td className="h-7 py-1 px-2">報酬率</td>
                                                <td className="h-7 py-1 px-2 text-center">
                                                    <StatBadge value={user.stats?.returnPercentage || 0} />
                                                </td>
                                                <td className="h-7 py-1 px-2 text-center">
                                                    {user.qqqStats ? <StatBadge value={user.qqqStats.returnPercentage} /> : '-'}
                                                </td>
                                                <td className="h-7 py-1 px-2 text-center">
                                                    {user.qldStats ? <StatBadge value={user.qldStats.returnPercentage} /> : '-'}
                                                </td>
                                            </tr>
                                            <tr className="border-t hover:bg-secondary/20 bg-white">
                                                <td className="h-7 py-1 px-2">最大回撤</td>
                                                <td className="h-7 py-1 px-2 text-center">
                                                    <StatBadge value={user.stats?.maxDrawdown || 0} variant="drawdown" />
                                                </td>
                                                <td className="h-7 py-1 px-2 text-center">
                                                    {user.qqqStats ? <StatBadge value={user.qqqStats.maxDrawdown} variant="drawdown" /> : '-'}
                                                </td>
                                                <td className="h-7 py-1 px-2 text-center">
                                                    {user.qldStats ? <StatBadge value={user.qldStats.maxDrawdown} variant="drawdown" /> : '-'}
                                                </td>
                                            </tr>
                                            <tr className="border-t hover:bg-secondary/20 bg-slate-50/50">
                                                <td className="h-7 py-1 px-2">年化報酬率</td>
                                                <td className="h-7 py-1 px-2 text-center">
                                                    {formatPercent(user.stats?.annualizedReturn || 0)}
                                                </td>
                                                <td className="h-7 py-1 px-2 text-center">
                                                    {user.qqqStats ? formatPercent(user.qqqStats.annualizedReturn) : '-'}
                                                </td>
                                                <td className="h-7 py-1 px-2 text-center">
                                                    {user.qldStats ? formatPercent(user.qldStats.annualizedReturn) : '-'}
                                                </td>
                                            </tr>
                                            <tr className="border-t hover:bg-secondary/20 bg-white">
                                                <td className="h-7 py-1 px-2">年化標準差</td>
                                                <td className="h-7 py-1 px-2 text-center">
                                                    {formatPercent(user.stats?.annualizedStdDev || 0)}
                                                </td>
                                                <td className="h-7 py-1 px-2 text-center">
                                                    {user.qqqStats ? formatPercent(user.qqqStats.annualizedStdDev) : '-'}
                                                </td>
                                                <td className="h-7 py-1 px-2 text-center">
                                                    {user.qldStats ? formatPercent(user.qldStats.annualizedStdDev) : '-'}
                                                </td>
                                            </tr>
                                            <tr className="border-t hover:bg-secondary/20 bg-slate-50/50">
                                                <td className="h-7 py-1 px-2">夏普值</td>
                                                <td className="h-7 py-1 px-2 text-center">
                                                    <StatBadge
                                                        value={user.stats?.sharpeRatio || 0}
                                                        variant="sharpe"
                                                        format={(v) => v.toFixed(2)}
                                                    />
                                                </td>
                                                <td className="h-7 py-1 px-2 text-center">
                                                    {user.qqqStats ? <StatBadge value={user.qqqStats.sharpeRatio || 0} variant="sharpe" format={(v) => v.toFixed(2)} /> : '-'}
                                                </td>
                                                <td className="h-7 py-1 px-2 text-center">
                                                    {user.qldStats ? <StatBadge value={user.qldStats.sharpeRatio || 0} variant="sharpe" format={(v) => v.toFixed(2)} /> : '-'}
                                                </td>
                                            </tr>
                                            <tr className="border-t hover:bg-secondary/20 bg-white">
                                                <td className="h-7 py-1 px-2">新高次數</td>
                                                <td className="h-7 py-1 px-2 text-center">
                                                    {user.stats?.newHighCount || 0}
                                                </td>
                                                <td className="h-7 py-1 px-2 text-center">
                                                    {user.qqqStats ? user.qqqStats.newHighCount : '-'}
                                                </td>
                                                <td className="h-7 py-1 px-2 text-center">
                                                    {user.qldStats ? user.qldStats.newHighCount : '-'}
                                                </td>
                                            </tr>
                                            <tr className="border-t hover:bg-secondary/20 bg-slate-50/50">
                                                <td className="h-7 py-1 px-2">新高頻率</td>
                                                <td className="h-7 py-1 px-2 text-center">
                                                    {Math.round((user.stats?.newHighFreq || 0) * 100)}%
                                                </td>
                                                <td className="h-7 py-1 px-2 text-center">
                                                    {user.qqqStats ? Math.round(user.qqqStats.newHighFreq * 100) + '%' : '-'}
                                                </td>
                                                <td className="h-7 py-1 px-2 text-center">
                                                    {user.qldStats ? Math.round(user.qldStats.newHighFreq * 100) + '%' : '-'}
                                                </td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>

                                {/* Chart - Matches Table Height */}
                                <div className="h-full min-h-[300px] flex items-center border rounded-md">
                                    <NetEquityChart
                                        data={user.equity_history || []}
                                        initialCost={user.initial_cost}
                                        name={user.user_id || 'scott'}
                                    />
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ))}

                {summaries.length === 0 && (
                    <div className="col-span-full text-center py-12 text-muted-foreground bg-secondary/10 rounded-lg border border-dashed">
                        尚無客戶資料
                    </div>
                )}
            </div>

            {
                editCostDialog && (
                    <SetInitialCostDialog
                        open={editCostDialog.open}
                        onOpenChange={(open) => !open && setEditCostDialog(null)}
                        userId={editCostDialog.userId}
                        currentCost={editCostDialog.currentCost}
                        onSuccess={() => {
                            setEditCostDialog(null);
                            fetchData();
                        }}
                    />
                )
            }
        </div >
    );
}

