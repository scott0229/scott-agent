'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, TrendingUp, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface UserSummary {
    id: number;
    user_id: string;
    email: string;
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
}

export default function NetEquityPage() {
    const [summaries, setSummaries] = useState<UserSummary[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [role, setRole] = useState<string | null>(null);
    const router = useRouter();

    useEffect(() => {
        fetchData();
    }, []);

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

            // Fetch summaries (Admin/Manager)
            const res = await fetch('/api/net-equity');
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
        <div className="container mx-auto py-8">
            <h1 className="text-3xl font-bold mb-8">帳戶績效總覽</h1>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {summaries.map((user) => (
                    <Card
                        key={user.id}
                        className="hover:shadow-lg transition-shadow cursor-pointer border-t-4 border-t-primary/20"
                        onClick={() => router.push(`/net-equity/${user.id}`)}
                    >
                        <CardHeader className="pb-2 bg-secondary/5">
                            <CardTitle className="flex justify-between items-center text-lg">
                                <span>{user.user_id || user.email}</span>
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="pt-4">
                            {!user.stats ? (
                                <div className="text-center text-muted-foreground py-8">
                                    尚無數據
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                                        <div className="text-muted-foreground">開始統計</div>
                                        <div className="font-mono text-right">{formatDate(user.stats.startDate)}</div>

                                        <div className="text-muted-foreground font-medium">報酬率</div>
                                        <div className={cn("font-mono text-right font-bold", user.stats.returnPercentage >= 0 ? "text-emerald-600" : "text-red-600")}>
                                            {formatPercent(user.stats.returnPercentage)}
                                        </div>

                                        <div className="text-muted-foreground">最大回撤</div>
                                        <div className="font-mono text-right text-red-600">
                                            {formatPercent(user.stats.maxDrawdown)}
                                        </div>

                                        <div className="col-span-2 border-t my-1"></div>

                                        <div className="text-muted-foreground">年化報酬率</div>
                                        <div className={cn("font-mono text-right", user.stats.annualizedReturn >= 0 ? "text-emerald-600" : "text-red-600")}>
                                            {formatPercent(user.stats.annualizedReturn)}
                                        </div>

                                        <div className="text-muted-foreground">年化標準差</div>
                                        <div className="font-mono text-right">
                                            {formatPercent(user.stats.annualizedStdDev)}
                                        </div>

                                        <div className="text-muted-foreground">夏普值</div>
                                        <div className={cn("font-mono text-right font-medium", user.stats.sharpeRatio >= 1 ? "text-emerald-600" : "text-foreground")}>
                                            {user.stats.sharpeRatio.toFixed(2)}
                                        </div>

                                        <div className="col-span-2 border-t my-1"></div>

                                        <div className="text-muted-foreground">新高次數</div>
                                        <div className="font-mono text-right">{user.stats.newHighCount}</div>

                                        <div className="text-muted-foreground">新高頻率</div>
                                        <div className="font-mono text-right">{formatPercent(user.stats.newHighFreq)}</div>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    );
}
