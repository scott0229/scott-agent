'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Loader2, Users, TrendingUp, BarChart3 } from "lucide-react";
import { useYearFilter } from '@/contexts/YearFilterContext';
import { OptionsClientSkeleton } from '@/components/LoadingSkeletons';
import { UserAnalysisDialog } from '@/components/UserAnalysisDialog';

interface UserStats {
    month: string;
    total_profit: number;
    put_profit: number;
    call_profit: number;
}

interface User {
    id: number;
    user_id: string;
    email: string;
    avatar_url: string | null;
    ib_account: string | null;
    options_count: number;
    monthly_stats?: UserStats[];
    total_profit?: number;
}


export default function OptionsPage() {
    const [clients, setClients] = useState<User[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [mounted, setMounted] = useState(false);
    const { selectedYear } = useYearFilter();
    const [analysisDialogOpen, setAnalysisDialogOpen] = useState(false);
    const [selectedUser, setSelectedUser] = useState<User | null>(null);
    const router = useRouter();

    useEffect(() => {
        const checkUserAndFetchClients = async () => {
            try {
                // 1. Check current user role
                const authRes = await fetch('/api/auth/me', { cache: 'no-store' });
                if (authRes.ok) {
                    const authData = await authRes.json();
                    console.log('Options Check Role:', authData.user);
                    if (authData.user && authData.user.role === 'customer') {
                        // Redirect customer to their own page
                        // Prefer user_id (string), fallback to id (number) if user_id is null
                        const targetId = authData.user.user_id || authData.user.id;
                        router.replace(`/options/${targetId}`);
                        return; // Stop execution
                    }
                }

                // 2. If not customer (admin/trader), fetch clients filtered by year
                const year = selectedYear === 'All' ? new Date().getFullYear() : selectedYear;
                const res = await fetch(`/api/users?mode=selection&roles=customer&year=${year}`);
                const data = await res.json();
                if (data.users) {
                    setClients(data.users);
                }
            } catch (error) {
                console.error('Failed to init options page:', error);
            } finally {
                setIsLoading(false);
            }
        };

        checkUserAndFetchClients();
    }, [router, selectedYear]); // Add selectedYear dependency

    useEffect(() => {
        setMounted(true);
    }, []);

    if (isLoading) {
        return (
            <div className="container mx-auto py-10 max-w-[1200px]">
                <div className="mb-8">
                    <h1 className="text-3xl font-bold">
                        {mounted ? (selectedYear === 'All' ? new Date().getFullYear() : selectedYear) : ''} 期權交易
                    </h1>
                </div>
                <OptionsClientSkeleton />
            </div>
        );
    }

    return (
        <div className="container mx-auto py-10 max-w-[1200px]">
            <div className="mb-8">
                <h1 className="text-3xl font-bold">
                    {mounted ? (selectedYear === 'All' ? new Date().getFullYear() : selectedYear) : ''} 期權交易
                </h1>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {clients.map((client) => {
                    const displayName = client.user_id || client.email.split('@')[0];
                    const initials = displayName.charAt(0).toUpperCase();

                    return (
                        <Card
                            key={client.id}
                            className="hover:shadow-lg transition-all hover:border-primary/50"
                        >
                            <CardHeader className="flex flex-row items-center gap-4 pb-1">
                                <Avatar className="h-12 w-12 border-2 border-transparent group-hover:border-primary transition-colors">
                                    <AvatarImage src={client.avatar_url || undefined} />
                                    <AvatarFallback>{initials}</AvatarFallback>
                                </Avatar>
                                <div className="flex flex-col overflow-hidden">
                                    <CardTitle className="text-lg truncate">{displayName}</CardTitle>
                                    <CardDescription className="truncate">
                                        {client.ib_account || client.email}
                                    </CardDescription>
                                </div>
                            </CardHeader>
                            <CardContent className="pt-0">
                                {client.monthly_stats && client.monthly_stats.length > 0 ? (
                                    <div>
                                        <div className="border rounded-md overflow-hidden">
                                            <table className="w-full text-xs">
                                                <thead className="bg-secondary/50">
                                                    <tr>
                                                        <th className="text-center py-1 px-2 font-medium">月份</th>
                                                        <th className="text-center py-1 px-2 font-medium">總損益</th>
                                                        <th className="text-center py-1 px-2 font-medium">PUT</th>
                                                        <th className="text-center py-1 px-2 font-medium">CALL</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="text-xs">
                                                    {client.monthly_stats.map((stat) => (
                                                        <tr key={stat.month} className="border-t hover:bg-secondary/20">
                                                            <td className="py-1 px-2 text-center">{stat.month}月</td>
                                                            <td className="py-1 px-2 text-center font-medium">
                                                                {stat.total_profit.toLocaleString()}
                                                            </td>
                                                            <td className="py-1 px-2 text-center">
                                                                {stat.put_profit.toLocaleString()}
                                                            </td>
                                                            <td className="py-1 px-2 text-center">
                                                                {stat.call_profit.toLocaleString()}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                    <tr className="border-t-2 bg-secondary/30 font-bold">
                                                        <td className="py-1 px-2 text-center">總計</td>
                                                        <td className="py-1 px-2 text-center">
                                                            {(client.total_profit ?? 0).toLocaleString()}
                                                        </td>
                                                        <td className="py-1 px-2 text-center">
                                                            {client.monthly_stats.reduce((sum, s) => sum + s.put_profit, 0).toLocaleString()}
                                                        </td>
                                                        <td className="py-1 px-2 text-center">
                                                            {client.monthly_stats.reduce((sum, s) => sum + s.call_profit, 0).toLocaleString()}
                                                        </td>
                                                    </tr>
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="text-sm text-muted-foreground mt-2">
                                        查看{client.options_count || 0}筆交易記錄 &rarr;
                                    </div>
                                )}
                                <div className="flex gap-2 mt-3">
                                    <Button
                                        onClick={() => router.push(`/options/${client.user_id || client.id}`)}
                                        className="flex-1"
                                        size="sm"
                                    >
                                        交易記錄
                                    </Button>
                                    <Button
                                        variant="outline"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setSelectedUser(client);
                                            setAnalysisDialogOpen(true);
                                        }}
                                        className="flex-1"
                                        size="sm"
                                    >
                                        <BarChart3 className="h-4 w-4 mr-1" />
                                        分析
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    );
                })}

                {clients.length === 0 && (
                    <div className="col-span-full text-center py-12 text-muted-foreground bg-secondary/10 rounded-lg border border-dashed">
                        尚無客戶資料
                    </div>
                )}
            </div>

            <UserAnalysisDialog
                user={selectedUser}
                year={selectedYear}
                open={analysisDialogOpen}
                onOpenChange={setAnalysisDialogOpen}
            />
        </div>
    );
}

