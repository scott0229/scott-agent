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

import { Pencil, BarChart3, Coins } from "lucide-react";

interface UserSummary {
    id: number;
    user_id: string;
    email: string;
    initial_cost: number;
    current_net_equity: number;
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
}

export default function NetEquityPage() {
    const [summaries, setSummaries] = useState<UserSummary[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [role, setRole] = useState<string | null>(null);
    const { selectedYear } = useYearFilter(); // Get year context
    const router = useRouter();
    const [editCostDialog, setEditCostDialog] = useState<{ open: boolean; userId: number; currentCost: number } | null>(null);
    const [sortOrder, setSortOrder] = useState('alphabetical');

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

    return (
        <div className="container mx-auto py-10 max-w-[1200px]">
            <div className="mb-8 flex justify-between items-center">
                <h1 className="text-3xl font-bold">
                    {selectedYear === 'All' ? new Date().getFullYear() : selectedYear} 帳戶績效
                </h1>
                <Select value={sortOrder} onValueChange={setSortOrder}>
                    <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="排序方式" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="alphabetical">按字母</SelectItem>
                        <SelectItem value="return-desc">報酬率-從大到小</SelectItem>
                        <SelectItem value="drawdown-desc">最大回撤-從大到小</SelectItem>
                        <SelectItem value="sharpe-desc">夏普值-從大到小</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[...summaries].sort((a, b) => {
                    if (sortOrder === 'alphabetical') {
                        const nameA = a.user_id || a.email;
                        const nameB = b.user_id || b.email;
                        return nameA.localeCompare(nameB);
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
                        className="hover:shadow-lg transition-all hover:border-primary/50 cursor-pointer"
                        onClick={() => router.push(`/net-equity/${user.id}`)}
                    >
                        <CardHeader className="flex flex-row items-center gap-4 pb-0">
                            <Avatar className="h-12 w-12 border-2 border-transparent group-hover:border-primary transition-colors">
                                <AvatarFallback>{(user.user_id || user.email).charAt(0).toUpperCase()}</AvatarFallback>
                            </Avatar>
                            <div className="flex flex-col overflow-hidden">
                                <CardTitle className="text-lg truncate">
                                    {user.user_id || user.email}
                                </CardTitle>
                                <CardDescription className="truncate">
                                    年初淨值: {formatMoney(user.initial_cost || 0)}
                                </CardDescription>
                            </div>
                        </CardHeader>
                        <CardContent className="-mt-2">
                            <div>
                                <div className="border rounded-md overflow-hidden">
                                    <table className="w-full text-sm">
                                        <tbody className="text-sm">
                                            <tr className="border-t hover:bg-secondary/20 bg-white">
                                                <td className="py-1 px-2">年初淨值</td>
                                                <td className="py-1 px-2 text-center">
                                                    {formatMoney(user.initial_cost || 0)}
                                                </td>
                                            </tr>
                                            <tr className="border-t hover:bg-secondary/20 bg-slate-50/50">
                                                <td className="py-1 px-2">當前淨值</td>
                                                <td className="py-1 px-2 text-center">
                                                    {formatMoney(user.current_net_equity || 0)}
                                                </td>
                                            </tr>
                                            <tr className="border-t hover:bg-secondary/20 bg-white">
                                                <td className="py-1 px-2">報酬率</td>
                                                <td className="py-1 px-2 text-center">
                                                    {formatPercent(user.stats?.returnPercentage || 0)}
                                                </td>
                                            </tr>
                                            <tr className="border-t hover:bg-secondary/20 bg-slate-50/50">
                                                <td className="py-1 px-2">最大回撤</td>
                                                <td className="py-1 px-2 text-center">
                                                    {formatPercent(user.stats?.maxDrawdown || 0)}
                                                </td>
                                            </tr>
                                            <tr className="border-t hover:bg-secondary/20 bg-white">
                                                <td className="py-1 px-2">年化報酬率</td>
                                                <td className="py-1 px-2 text-center">
                                                    {formatPercent(user.stats?.annualizedReturn || 0)}
                                                </td>
                                            </tr>
                                            <tr className="border-t hover:bg-secondary/20 bg-slate-50/50">
                                                <td className="py-1 px-2">年化標準差</td>
                                                <td className="py-1 px-2 text-center">
                                                    {formatPercent(user.stats?.annualizedStdDev || 0)}
                                                </td>
                                            </tr>
                                            <tr className="border-t hover:bg-secondary/20 bg-white">
                                                <td className="py-1 px-2">夏普值</td>
                                                <td className="py-1 px-2 text-center">
                                                    {(user.stats?.sharpeRatio || 0).toFixed(2)}
                                                </td>
                                            </tr>
                                            <tr className="border-t hover:bg-secondary/20 bg-slate-50/50">
                                                <td className="py-1 px-2">新高次數</td>
                                                <td className="py-1 px-2 text-center">
                                                    {user.stats?.newHighCount || 0}
                                                </td>
                                            </tr>
                                            <tr className="border-t hover:bg-secondary/20 bg-white">
                                                <td className="py-1 px-2">新高頻率</td>
                                                <td className="py-1 px-2 text-center">
                                                    {formatPercent(user.stats?.newHighFreq || 0)}
                                                </td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <div className="flex gap-2 mt-3">
                                <Button
                                    variant="outline"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        router.push(`/net-equity/${user.id}`);
                                    }}
                                    className="flex-1"
                                    size="sm"
                                >
                                    淨值記錄
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {editCostDialog && (
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
            )}
        </div>
    );
}

