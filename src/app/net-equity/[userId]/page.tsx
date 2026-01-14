'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowLeft, Star, Download, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { NewNetEquityDialog } from '@/components/NewNetEquityDialog';
import { useToast } from "@/hooks/use-toast";

interface PerformanceRecord {
    id: number;
    date: number;
    net_equity: number;
    daily_deposit: number;
    daily_return: number;
    nav_ratio: number;
    running_peak: number;
    drawdown: number;
    is_new_high: boolean;
}

export default function NetEquityDetailPage() {
    const params = useParams();
    const router = useRouter();
    const [records, setRecords] = useState<PerformanceRecord[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);
    const [userName, setUserName] = useState<string>('');
    const [isNewDialogOpen, setIsNewDialogOpen] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const { toast } = useToast();

    // Safe parsing of userId
    const userId = typeof params.userId === 'string' ? params.userId : '';

    useEffect(() => {
        if (userId) {
            checkAuthAndFetch();
        }
    }, [userId]);

    const checkAuthAndFetch = async () => {
        try {
            const authRes = await fetch('/api/auth/me');
            if (authRes.ok) {
                const authData = await authRes.json();
                setCurrentUserRole(authData.user?.role || null);
            }

            // Fetch user details for header name
            // (Optional optimization: API could return user name in meta)
            // For now, let's just fetch records, maybe name is separate.
            // Actually, we can fetch user profile? 
            // Let's assume we want to show "User X Performance".

            await fetchRecords();

        } catch (error) {
            console.error('Error:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const fetchRecords = async () => {
        try {
            const res = await fetch(`/api/net-equity?userId=${userId}`);
            const data = await res.json();
            if (data.success) {
                setRecords(data.data);
            } else {
                if (res.status === 403) {
                    toast({
                        variant: "destructive",
                        title: "權限不足",
                        description: "您無法查看此用戶的資料",
                    });
                    router.push('/');
                }
            }
        } catch (error) {
            console.error('Failed to fetch records:', error);
        }
    };

    const formatDate = (timestamp: number) => {
        const date = new Date(timestamp * 1000); // Daily records are unix timestamps
        // Format YY-MM-DD as per screenshot "25-12-31"
        return `${String(date.getFullYear()).slice(2)}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    };

    const formatMoney = (val: number) => {
        return new Intl.NumberFormat('en-US').format(Math.round(val));
    };

    const formatPercent = (val: number) => {
        return `${(val * 100).toFixed(2)}%`;
    };

    const getReturnColor = (val: number) => {
        if (val > 0) return "text-emerald-600 font-medium";
        if (val < 0) return "text-red-600 font-medium";
        return "text-muted-foreground";
    };

    const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsImporting(true);
        const reader = new FileReader();

        reader.onload = async (event) => {
            try {
                const text = event.target?.result as string;
                if (!text) return;

                const lines = text.split(/\r?\n/);
                const records: any[] = [];
                let headers: string[] = [];

                // Simple CSV Parser
                lines.forEach((line, index) => {
                    const cleanLine = line.trim();
                    if (!cleanLine) return;

                    const cols = cleanLine.split(',').map(c => c.trim());

                    if (index === 0) {
                        // Check for headers or assume format?
                        // Let's assume headers exist if first col is not a date number
                        // Or just skip first line if it looks like header
                        if (isNaN(Date.parse(cols[0])) && cols[0].toLowerCase().includes('date')) {
                            headers = cols.map(h => h.toLowerCase());
                            return; // Skip header
                        }
                    }

                    // Assume format: Date, NetEquity
                    // Or Map specific headers
                    let dateStr = cols[0];
                    let equityStr = cols[1];

                    if (headers.length > 0) {
                        // Try to find by name
                        const dateIdx = headers.findIndex(h => h.includes('date') || h.includes('日期'));
                        const eqIdx = headers.findIndex(h => h.includes('equity') || h.includes('net') || h.includes('淨值'));
                        if (dateIdx !== -1) dateStr = cols[dateIdx];
                        if (eqIdx !== -1) equityStr = cols[eqIdx];
                    }

                    if (dateStr && equityStr) {
                        const val = parseFloat(equityStr);
                        if (!isNaN(val)) {
                            records.push({
                                user_id: parseInt(userId),
                                date: dateStr, // API handles string parsing
                                net_equity: val
                            });
                        }
                    }
                });

                if (records.length === 0) {
                    throw new Error("無法解析 CSV 内容。請確保格式為：日期,淨值 (例如 2026-01-01,100000)");
                }

                const res = await fetch('/api/net-equity/import', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ records }),
                });

                const data = await res.json();
                if (data.success) {
                    toast({
                        title: "匯入成功",
                        description: `成功匯入 ${data.count} 筆記錄`,
                    });
                    fetchRecords();
                } else {
                    throw new Error(data.error || "匯入失敗");
                }

            } catch (error: any) {
                toast({
                    variant: "destructive",
                    title: "匯入錯誤",
                    description: error.message,
                });
            } finally {
                setIsImporting(false);
                // Reset input
                e.target.value = '';
            }
        };

        reader.readAsText(file);
    };

    if (isLoading) {
        return (
            <div className="flex h-screen items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    const isAdmin = ['admin', 'manager'].includes(currentUserRole || '');

    return (
        <div className="container mx-auto py-8">
            <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                    {isAdmin && (
                        <Button variant="ghost" size="icon" onClick={() => router.push('/net-equity')}>
                            <ArrowLeft className="h-4 w-4" />
                        </Button>
                    )}
                    <h1 className="text-3xl font-bold">帳戶績效詳細記錄</h1>
                </div>

                {isAdmin && (
                    <div className="flex items-center gap-2">
                        <Button variant="outline" className="gap-2" onClick={() => document.getElementById('import-equity')?.click()}>
                            <Download className="h-4 w-4" />
                            匯入
                            <input
                                id="import-equity"
                                type="file"
                                className="hidden"
                                accept=".csv,.json"
                                onChange={handleImport}
                            />
                        </Button>
                        <Button
                            className="gap-2"
                            onClick={() => setIsNewDialogOpen(true)}
                        >
                            <Plus className="h-4 w-4" />
                            新增記錄
                        </Button>
                    </div>
                )}
            </div>

            <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-secondary/50 hover:bg-secondary/50">
                            <TableHead className="w-[100px] text-center font-bold text-foreground">分析表</TableHead>
                            <TableHead className="text-right font-bold text-foreground">帳戶淨值</TableHead>
                            <TableHead className="text-right font-bold text-foreground">當日入金</TableHead>
                            <TableHead className="text-right font-bold text-foreground">當日報酬率</TableHead>
                            <TableHead className="text-right font-bold text-foreground">淨值率</TableHead>
                            <TableHead className="text-right font-bold text-foreground">running peak</TableHead>
                            <TableHead className="text-right font-bold text-foreground">drawdown</TableHead>
                            <TableHead className="text-center font-bold text-foreground">新高記錄</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {records.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                                    尚無記錄
                                </TableCell>
                            </TableRow>
                        ) : (
                            records.map((record) => (
                                <TableRow key={record.id} className="hover:bg-muted/50">
                                    <TableCell className="text-center font-mono font-medium">
                                        {formatDate(record.date)}
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-base">
                                        {formatMoney(record.net_equity)}
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-muted-foreground">
                                        {record.daily_deposit !== 0 ? formatMoney(record.daily_deposit) : '0'}
                                    </TableCell>
                                    <TableCell className={cn("text-right font-mono", getReturnColor(record.daily_return))}>
                                        {formatPercent(record.daily_return)}
                                    </TableCell>
                                    <TableCell className="text-right font-mono">
                                        {formatPercent(record.nav_ratio)}
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-muted-foreground">
                                        {formatPercent(record.running_peak)}
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-red-600">
                                        {formatPercent(record.drawdown)}
                                    </TableCell>
                                    <TableCell className="text-center">
                                        {record.is_new_high && (
                                            <div className="flex justify-center">
                                                <Star className="h-4 w-4 fill-yellow-400 text-yellow-500" />
                                            </div>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>

            <NewNetEquityDialog
                open={isNewDialogOpen}
                onOpenChange={setIsNewDialogOpen}
                userId={parseInt(userId)}
                onSuccess={fetchRecords}
            />
        </div>
    );
}
