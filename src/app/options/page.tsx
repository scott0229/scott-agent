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
import { Loader2, Users } from "lucide-react";
import { useYearFilter } from '@/contexts/YearFilterContext';

interface User {
    id: number;
    email: string;
    user_id: string | null;
    avatar_url: string | null;
    ib_account?: string | null;
}

export default function OptionsClientListPage() {
    const [clients, setClients] = useState<User[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const router = useRouter();
    const { selectedYear } = useYearFilter();

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

    if (isLoading) {
        return (
            <div className="flex h-[50vh] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="container mx-auto py-10 max-w-[1200px]">
            <div className="mb-8">
                <h1 className="text-3xl font-bold flex items-center gap-3">
                    <Users className="h-8 w-8" />
                    {selectedYear} 期權管理
                </h1>
                <p className="text-muted-foreground mt-2">
                    選擇一位客戶以管理其期權交易紀錄
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {clients.map((client) => {
                    const displayName = client.user_id || client.email.split('@')[0];
                    const initials = displayName.charAt(0).toUpperCase();

                    return (
                        <Card
                            key={client.id}
                            className="cursor-pointer hover:shadow-lg transition-all hover:border-primary/50 group"
                            onClick={() => router.push(`/options/${client.user_id || client.id}`)} // Use user_id if available, fallback to id if needed (though standardizing on user_id is better)
                        >
                            <CardHeader className="flex flex-row items-center gap-4 pb-2">
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
                            <CardContent>
                                <div className="text-sm text-muted-foreground mt-2">
                                    點擊查看交易紀錄 &rarr;
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
        </div>
    );
}
