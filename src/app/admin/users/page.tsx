'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { AdminUserDialog } from '@/components/AdminUserDialog';
import { Badge } from "@/components/ui/badge";
import { Pencil, Trash2, Download, Upload, Wallet, DollarSign } from "lucide-react";
import { useYearFilter } from '@/contexts/YearFilterContext';
import { UserSelectionDialog } from "@/components/UserSelectionDialog";
import { ProgressDialog } from "@/components/ProgressDialog";


interface User {
    id: number;
    email: string;
    user_id: string | null;
    role: string;
    management_fee?: number;
    ib_account?: string;
    phone?: string;
    initial_cost?: number;
    options_count?: number;
    open_count?: number;
    net_deposit?: number;
    created_at: number;
    deposits_count?: number;
    interest_count?: number;
    fees_count?: number;
    total_profit?: number;
    current_net_equity?: number;
    stock_trades_count?: number;
    strategies_count?: number;
}

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
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";

export default function AdminUsersPage() {
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<User | null>(null);
    const [userToDelete, setUserToDelete] = useState<number | null>(null);
    const [importing, setImporting] = useState(false);
    const [mounted, setMounted] = useState(false);
    const [currentUser, setCurrentUser] = useState<{ role: string } | null>(null);
    const [marketDataCount, setMarketDataCount] = useState(0);

    // New State for Selection/Progress
    const [exportSelectionOpen, setExportSelectionOpen] = useState(false);
    const [importSelectionOpen, setImportSelectionOpen] = useState(false);
    const [progressOpen, setProgressOpen] = useState(false);
    const [progressValue, setProgressValue] = useState(0);
    const [progressMessage, setProgressMessage] = useState("");

    // In-Dialog Progress State (Import)
    const [importProcessing, setImportProcessing] = useState(false);
    const [importProgress, setImportProgress] = useState(0);
    const [completedImportIds, setCompletedImportIds] = useState<(number | string)[]>([]);

    // In-Dialog Progress State (Export)
    const [exportProcessing, setExportProcessing] = useState(false);
    const [exportProgress, setExportProgress] = useState(0);

    // Data holders
    const [selectionUsers, setSelectionUsers] = useState<any[]>([]); // For dialog options
    const [pendingImportData, setPendingImportData] = useState<any>(null); // To hold parsed JSON before import

    const { toast } = useToast();
    const router = useRouter();
    const { selectedYear } = useYearFilter();

    const fetchCurrentUser = async () => {
        try {
            const res = await fetch('/api/auth/me');
            if (res.ok) {
                const data = await res.json();
                setCurrentUser(data.user);
            }
        } catch (error) {
            console.error('Failed to fetch current user', error);
        }
    };

    const handleEdit = (user: User) => {
        setEditingUser(user);
        setDialogOpen(true);
    };

    const fetchUsers = async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            // Fetch users filtered by year
            const year = selectedYear === 'All' ? new Date().getFullYear() : selectedYear;
            const res = await fetch(`/api/users?year=${year}`);
            if (res.status === 403) {
                toast({
                    variant: "destructive",
                    title: "權限不足",
                    description: "您沒有權限訪問此頁面",
                });
                router.push('/');
                return;
            }
            const data = await res.json();
            if (data.users) {
                setUsers(data.users);
            }
            if (data.meta && typeof data.meta.marketDataCount === 'number') {
                setMarketDataCount(data.meta.marketDataCount);
            }
        } catch (error) {
            console.error('Failed to fetch users', error);
        } finally {
            if (!silent) setLoading(false);
        }
    };

    useEffect(() => {
        setMounted(true);
        fetchCurrentUser();
    }, []);

    useEffect(() => {
        fetchUsers();
    }, [selectedYear]); // Add selectedYear dependency

    const handleDelete = async (id: number) => {
        setUserToDelete(id);
    };

    const confirmDelete = async () => {
        if (!userToDelete) return;

        try {
            // Delete user
            const res = await fetch(`/api/users/${userToDelete}`, {
                method: 'DELETE',
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to delete');
            }


            fetchUsers(true);
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "錯誤",
                description: error.message,
            });
        } finally {
            setUserToDelete(null);
        }
    };

    const handleExportClick = () => {
        // Prepare selection list from current users (excluding admin)
        const exportableUsers: { id: number | string; display: string; checked: boolean }[] = users
            .filter(u => u.email !== 'admin')
            .map(u => ({
                id: u.id,
                display: `${u.user_id || u.email.split('@')[0]} (${u.ib_account || 'No IB'})`,
                checked: true
            }));

        // Calculate Totals for Labels
        const totalOptions = users
            .filter(u => u.email !== 'admin')
            .reduce((sum, u) => sum + (u.options_count || 0), 0);



        const totalStocks = users
            .filter(u => u.email !== 'admin')
            .reduce((sum, u) => sum + (u.stock_trades_count || 0), 0);

        const totalStrategies = users
            .filter(u => u.email !== 'admin')
            .reduce((sum, u) => sum + (u.strategies_count || 0), 0);

        // Add Options Records Option
        exportableUsers.push({
            id: 'options_records',
            display: `期權交易記錄 (${totalOptions} 筆)`,
            checked: true
        });

        // Add Stock Trades Option
        exportableUsers.push({
            id: 'stock_trades',
            display: `股票交易記錄 (${totalStocks} 筆)`,
            checked: true
        });

        // Add Strategies Option
        exportableUsers.push({
            id: 'strategies',
            display: `投資策略資料 (${totalStrategies} 個)`,
            checked: true
        });



        // Add Market Data Option
        exportableUsers.push({
            id: 'market_data',
            display: `歷史股價資料 (${marketDataCount} 筆)`,
            checked: true
        });

        setSelectionUsers(exportableUsers);
        setExportProcessing(false);
        setExportProgress(0);
        setExportSelectionOpen(true);
    };

    const confirmExport = async (selectedIds: (number | string)[]) => {
        // DO NOT close dialog, show progress in-dialog
        try {
            setExportProcessing(true);
            setExportProgress(10); // Start

            const year = selectedYear === 'All' ? new Date().getFullYear() : selectedYear;

            // Separate Options selection
            const includeMarketData = selectedIds.includes('market_data');
            // deposit_records removed
            const includeOptionsRecords = selectedIds.includes('options_records');
            const includeStockRecords = selectedIds.includes('stock_trades');
            const includeStrategies = selectedIds.includes('strategies');

            const realUserIds = selectedIds.filter(id =>
                id !== 'market_data' &&
                id !== 'options_records' &&
                id !== 'interest_records' &&
                id !== 'stock_trades' &&
                id !== 'fees_records' &&
                id !== 'strategies'
            );

            // Call POST endpoint with selected IDs
            const res = await fetch('/api/users/export', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    year: selectedYear,
                    userIds: realUserIds,
                    includeMarketData: includeMarketData,
                    includeOptionsRecords: includeOptionsRecords,
                    includeStockRecords: includeStockRecords,
                    includeStrategies: includeStrategies
                })
            });

            setExportProgress(70);

            if (!res.ok) {
                throw new Error('匯出失敗');
            }

            const data = await res.json();
            setExportProgress(100);

            // Create JSON blob and download
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const dateStr = new Date().toISOString().split('T')[0];
            a.download = `users_export_${dateStr}_(${data.count}).json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

        } catch (error: any) {
            setExportProcessing(false);
            toast({
                variant: "destructive",
                title: "匯出失敗",
                description: error.message,
            });
        }
    };

    const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        try {
            const text = await file.text();
            const data = JSON.parse(text);

            let usersList = [];
            if (Array.isArray(data)) {
                usersList = data;
                setPendingImportData({ users: data });
            } else {
                usersList = data.users || [];
                setPendingImportData(data);
            }

            if (!usersList || usersList.length === 0) {
                throw new Error("檔案中沒有使用者資料");
            }

            const importableUsers: { id: number | string; display: string; checked: boolean; disabled?: boolean }[] = usersList.map((u: any, idx: number) => {
                const exists = users.some(existing => existing.email === u.email);
                return {
                    id: u.email, // Use email as unique key for selection
                    display: `${u.user_id || u.email.split('@')[0]} (${u.ib_account || 'No IB'})`,
                    checked: !exists,
                    disabled: exists,
                    statusLabel: exists ? '已存在' : undefined
                };
            });

            // Check for Deposit Records choice REMOVED (Merged into net_equity)
            const totalOptions = usersList.reduce((sum: number, u: any) => sum + (Array.isArray(u.options) ? u.options.length : 0), 0);
            const totalStocks = usersList.reduce((sum: number, u: any) => sum + (Array.isArray(u.stock_trades) ? u.stock_trades.length : 0), 0);

            // Check for Options Records choice
            importableUsers.push({
                id: 'options_records',
                display: `期權交易記錄 (${totalOptions} 筆)`,
                checked: totalOptions > 0,
                disabled: totalOptions === 0
            } as any);



            // Check for Stock Trades choice
            importableUsers.push({
                id: 'stock_trades',
                display: `股票交易記錄 (${totalStocks} 筆)`,
                checked: totalStocks > 0,
                disabled: totalStocks === 0
            } as any);

            // Check for Strategies
            const totalStrategies = usersList.reduce((sum: number, u: any) => sum + (Array.isArray(u.strategies) ? u.strategies.length : 0), 0);
            importableUsers.push({
                id: 'strategies',
                display: `投資策略資料 (${totalStrategies} 個)`,
                checked: totalStrategies > 0,
                disabled: totalStrategies === 0
            } as any);


            // Check for Market Data
            if (data.market_prices && data.market_prices.length > 0) {
                importableUsers.push({
                    id: 'market_data',
                    display: `歷史股價資料 (${data.market_prices.length} 筆)`,
                    checked: true
                });
            }

            setSelectionUsers(importableUsers);
            setImportProcessing(false);
            setImportProgress(0);
            setCompletedImportIds([]);
            setImportSelectionOpen(true);

            // Reset input
            event.target.value = '';
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "讀取檔案失敗",
                description: error.message,
            });
        }
    };

    const confirmImport = async (selectedIds: (number | string)[]) => {
        // DO NOT close dialog, start processing
        if (!pendingImportData) return;

        try {
            setImportProcessing(true);
            setImportProgress(0);
            setCompletedImportIds([]);

            const importMarketData = selectedIds.includes('market_data');
            // deposit_records removed
            const importOptions = selectedIds.includes('options_records');
            const importStocks = selectedIds.includes('stock_trades');
            const importStrategies = selectedIds.includes('strategies');

            const selectedUserEmails = selectedIds.filter(id =>
                id !== 'market_data' &&
                id !== 'options_records' &&
                id !== 'interest_records' &&
                id !== 'stock_trades' &&
                id !== 'fees_records' &&
                id !== 'strategies'
            );

            const allUsers = pendingImportData.users || [];
            // Filter users based on selection
            const selectedUsers = allUsers.filter((u: any) => selectedUserEmails.includes(u.email));

            // Prepare Payload Structure
            const marketPrices = pendingImportData.market_prices || [];
            const sourceYear = pendingImportData.sourceYear;
            const targetYear = selectedYear === 'All' ? 'All' : selectedYear;

            // Scenario 1: Only Market Data selected
            if (importMarketData && selectedUsers.length === 0) {
                setImportProgress(10);
                const res = await fetch(`/api/users/import?targetYear=${targetYear}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        users: [], // No users
                        market_prices: marketPrices,
                        sourceYear: sourceYear
                    }),
                });

                if (!res.ok) {
                    const result = await res.json();
                    throw new Error(result.error || 'Market data import failed');
                }

                setImportProgress(100);
                setCompletedImportIds(['market_data']);
                fetchUsers(true);
                return;
            }

            // Scenario 2: Users (and optionally Market Data / Options / Interest)
            // Step 2: Batch Upload Users
            const TOTAL = selectedUsers.length;
            const BATCH_SIZE = 5; // Import 5 users at a time
            let processed = 0;
            // Unused variables commented out to prevent linter warnings
            // let totalImported = 0;
            // let totalSkipped = 0;
            const errors: string[] = [];

            for (let i = 0; i < TOTAL; i += BATCH_SIZE) {
                const chunk = selectedUsers.slice(i, i + BATCH_SIZE);

                const processedChunk = chunk.map((u: any) => {
                    const clone = { ...u };
                    // deposit logic removed
                    if (!importOptions) delete clone.options;
                    if (!importStocks) delete clone.stock_trades;
                    if (!importStrategies) delete clone.strategies;
                    return clone;
                });

                // Only include market_prices in the VERY FIRST Request if selected
                const chunkPayload = {
                    users: processedChunk,
                    market_prices: (i === 0 && importMarketData) ? marketPrices : [],
                    sourceYear: sourceYear
                };

                const res = await fetch(`/api/users/import?targetYear=${targetYear}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(chunkPayload),
                });

                const result = await res.json();

                if (!res.ok) {
                    throw new Error(result.error || `Batch ${i} failed`);
                }

                // totalImported += (result.imported || 0) + (result.updated || 0);
                // totalSkipped += (result.skipped || 0);
                if (result.errors) errors.push(...result.errors);

                // Update Progress
                setCompletedImportIds(prev => {
                    const newIds = [...prev, ...chunk.map((u: any) => u.email)];
                    // Mark global items as completed after first batch if included
                    if (i === 0 && importMarketData && !prev.includes('market_data')) {
                        newIds.push('market_data');
                    }
                    if (i === 0 && importOptions && !prev.includes('options_records')) {
                        newIds.push('options_records');
                    }
                    if (i === 0 && importStocks && !prev.includes('stock_trades')) {
                        newIds.push('stock_trades');
                    }
                    return newIds;
                });

                processed += chunk.length;
                const progressPct = Math.round((processed / TOTAL) * 90); // Scale to 90%
                setImportProgress(progressPct);
            }

            // FORCE 100% to ensure UI unlocks
            setImportProgress(100);
            // Refresh list but keep dialog state stable until closed
            fetchUsers(true);

            if (errors.length > 0) {
                toast({
                    variant: "destructive",
                    title: "匯入完成但有錯誤",
                    description: `共有 ${errors.length} 個錯誤發生。`,
                });
            }

        } catch (error: any) {
            setImportProcessing(false);
            toast({
                variant: "destructive",
                title: "匯入失敗",
                description: error.message,
            });
        }
    };
    // ...
    // Note: I will update the UserSelectionDialog instances below in the JSX return part in another pass or rely on multi chunk?
    // Wait, the instruction only covered the logic functions. I need to update the JSX return to include the new dependencies too.
    // The previous tool call covered lines 171-424.
    // I need to update the JSX part too. 
    // Let's rely on `multi_replace` or just do it all here if I can find the JSX.
    // The JSX is further down.
    // I will use `TargetContent` for the function bodies.
    // I will handle the JSX update in a separate call or try to verify if I can reach it.
    // The file is 791 lines.
    // `confirmImport` ends around line 430.
    // `dependencies` prop is passed in JSX around line 700.
    // I will stick to updating functions first.


    const [deleteAllDialogOpen, setDeleteAllDialogOpen] = useState(false);

    const confirmDeleteAll = async () => {
        try {
            const res = await fetch(`/api/users?mode=all&year=${selectedYear}`, {
                method: 'DELETE',
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || '刪除失敗');
            }

            const data = await res.json();
            // Toast removed
            fetchUsers(true);
            setDeleteAllDialogOpen(false);
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "錯誤",
                description: error.message,
            });
        }
    };

    const getRoleBadge = (role: string) => {
        switch (role) {
            case 'admin':
                return <Badge variant="secondary" className="bg-slate-100 text-slate-600 hover:bg-slate-100 border border-slate-200">系統管理員</Badge>;
            case 'manager':
                return <Badge variant="secondary" className="bg-slate-100 text-slate-600 hover:bg-slate-100 border border-slate-200">管理者</Badge>;
            case 'trader':
                return <Badge variant="secondary" className="bg-slate-100 text-slate-600 hover:bg-slate-100 border border-slate-200">交易員</Badge>;
            default:
                return <Badge variant="secondary" className="bg-slate-100 text-slate-600 hover:bg-slate-100 border border-slate-200">客戶</Badge>;
        }
    };

    if (loading) return <div className="p-8">載入中...</div>;

    const formatPhoneNumber = (phone?: string) => {
        if (!phone) return '-';
        // Remove all non-numeric characters
        const clean = phone.replace(/\D/g, '');
        // Check if it matches typical Taiwan mobile length (10 digits)
        if (clean.length === 10) {
            // Format as 09XX-XXXXXX
            return `${clean.slice(0, 4)}-${clean.slice(4)}`;
        }
        return phone;
    };

    const formatMoney = (val?: number) => {
        if (val === undefined || val === null) return '-';
        return new Intl.NumberFormat('en-US').format(Math.round(val));
    };

    return (
        <TooltipProvider delayDuration={300}>
            <div className="container mx-auto py-10">
                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-3xl font-bold">
                        {mounted ? (selectedYear === 'All' ? new Date().getFullYear() : selectedYear) : ''} 用戶設定
                    </h1>
                    <div className="flex gap-2">
                        {/* Only show actions for admin/manager/trader, NOT customer */}
                        {currentUser?.role !== 'customer' && currentUser?.role !== 'trader' && (
                            <>

                                <Button
                                    onClick={handleExportClick}
                                    variant="outline"
                                    className="hover:bg-accent hover:text-accent-foreground"
                                >
                                    <Upload className="h-4 w-4 mr-2" />
                                    匯出
                                </Button>
                                <Button
                                    variant="outline"
                                    className="hover:bg-accent hover:text-accent-foreground relative"
                                    disabled={importing}
                                >
                                    <Download className="h-4 w-4 mr-2" />
                                    匯入
                                    <input
                                        type="file"
                                        accept=".json"
                                        onChange={handleImportFile}
                                        className="absolute inset-0 opacity-0 cursor-pointer"
                                        disabled={importing}
                                    />
                                </Button>
                                {selectedYear !== 'All' && (
                                    <Button
                                        onClick={() => setDeleteAllDialogOpen(true)}
                                        variant="outline"
                                        className="hover:bg-red-50 hover:text-red-600 hover:border-red-200"
                                    >
                                        <Trash2 className="h-4 w-4 mr-2" />
                                        刪除全部
                                    </Button>
                                )}
                                <Button
                                    onClick={() => { setEditingUser(null); setDialogOpen(true); }}
                                    variant="secondary"
                                    className="hover:bg-accent hover:text-accent-foreground"
                                >
                                    <span className="mr-0.5">+</span>新增
                                </Button>
                            </>
                        )}
                    </div>
                </div>

                <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-secondary hover:bg-secondary">
                                <TableHead className="w-[50px] text-center">#</TableHead>
                                <TableHead className="text-center">角色</TableHead>
                                <TableHead className="text-center">帳號</TableHead>
                                <TableHead className="text-center">管理費率</TableHead>


                                <TableHead className="text-center">年初淨值</TableHead>
                                <TableHead className="text-center">IB 帳號</TableHead>
                                <TableHead className="text-center">手機號碼</TableHead>
                                <TableHead>郵件地址</TableHead>
                                <TableHead className="text-right"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {(() => {
                                const filteredUsers = users.filter(u => u.email !== 'admin');
                                if (filteredUsers.length === 0) {
                                    return (
                                        <TableRow className="hover:bg-transparent">
                                            <TableCell colSpan={10} className="p-4">
                                                <div className="text-center py-12 text-muted-foreground bg-secondary/10 rounded-lg border border-dashed">
                                                    尚無客戶資料
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    );
                                }

                                const sortedUsers = [...filteredUsers].sort((a, b) => {
                                    const equityA = a.current_net_equity || 0;
                                    const equityB = b.current_net_equity || 0;
                                    return equityB - equityA;
                                });

                                return sortedUsers.map((user, index) => {
                                    const currentEquity = user.current_net_equity || 0;
                                    return (
                                        <TableRow key={user.id}>
                                            <TableCell className="text-center text-muted-foreground font-mono">{index + 1}</TableCell>
                                            <TableCell className="text-center">{getRoleBadge(user.role)}</TableCell>
                                            <TableCell className="text-center">{user.user_id || '-'}</TableCell>
                                            <TableCell className="text-center">
                                                {user.role === 'customer' ? (
                                                    user.management_fee === 0 ? (
                                                        <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50">
                                                            不收費
                                                        </Badge>
                                                    ) : (
                                                        `${user.management_fee}%`
                                                    )
                                                ) : '-'}
                                            </TableCell>


                                            <TableCell className="text-center">{user.role === 'customer' ? formatMoney(user.initial_cost) : '-'}</TableCell>
                                            <TableCell className="text-center">{user.role === 'customer' ? (user.ib_account || '-') : '-'}</TableCell>
                                            <TableCell className="text-center">{formatPhoneNumber(user.phone)}</TableCell>
                                            <TableCell>{user.email}</TableCell>
                                            <TableCell className="text-right">
                                                {currentUser?.role !== 'trader' && currentUser?.role !== 'customer' && (
                                                    <div className="flex justify-end gap-1">
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    onClick={() => handleEdit(user)}
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
                                                                    onClick={() => handleDelete(user.id)}
                                                                    className="text-muted-foreground hover:text-red-600 hover:bg-red-50"
                                                                >
                                                                    <Trash2 className="h-4 w-4" />
                                                                </Button>
                                                            </TooltipTrigger>
                                                            <TooltipContent>
                                                                <p>刪除</p>
                                                            </TooltipContent>
                                                        </Tooltip>
                                                    </div>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    );
                                });
                            })()}
                        </TableBody>
                    </Table>
                </div>

                <AdminUserDialog
                    open={dialogOpen}
                    onOpenChange={(open) => {
                        setDialogOpen(open);
                        if (!open) setEditingUser(null);
                    }}
                    onSuccess={fetchUsers}
                    userToEdit={editingUser}
                />

                <AlertDialog open={!!userToDelete} onOpenChange={(open) => !open && setUserToDelete(null)}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>
                                確定要刪除 {users.find(u => u.id === userToDelete)?.user_id || users.find(u => u.id === userToDelete)?.email || '此使用者'} 帳戶嗎？
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                                此操作無法復原。這將永久刪除此使用者帳號及其所有相關資料。
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>取消</AlertDialogCancel>
                            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">
                                刪除
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>

                <AlertDialog open={deleteAllDialogOpen} onOpenChange={setDeleteAllDialogOpen}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>
                                確定要刪除 {selectedYear} 年度的所有使用者嗎？
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                                此操作無法復原。這將永久刪除該年度的所有使用者資料（除了您自己的帳號）。
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>取消</AlertDialogCancel>
                            <AlertDialogAction onClick={confirmDeleteAll} className="bg-red-600 hover:bg-red-700">
                                確認刪除全部
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
                <UserSelectionDialog
                    open={exportSelectionOpen}
                    onOpenChange={setExportSelectionOpen}
                    title={`選擇${selectedYear === 'All' ? '' : selectedYear}要匯出的使用者`}
                    users={selectionUsers}
                    onConfirm={confirmExport}
                    confirmLabel="開始匯出"
                    // New Props for Export Progress
                    processing={exportProcessing}
                    progress={exportProgress}
                    preventCloseOnConfirm={true}
                    dependencies={{
                        'options_records': {
                            satisfied: (selected) => Array.from(selected).some(id => typeof id === 'number')
                        },
                        'interest_records': {
                            satisfied: (selected) => Array.from(selected).some(id => typeof id === 'number')
                        },
                        'fees_records': {
                            satisfied: (selected) => Array.from(selected).some(id => typeof id === 'number')
                        }
                    }}
                />
                <UserSelectionDialog
                    open={importSelectionOpen}
                    onOpenChange={(open) => {
                        setImportSelectionOpen(open);
                        if (!open) {
                            // Reset state only when strictly closed
                            setImportProcessing(false);
                            setImportProgress(0);
                            setCompletedImportIds([]);
                            setPendingImportData(null);
                            setSelectionUsers([]);
                        }
                    }}
                    title={
                        pendingImportData?.sourceYear && selectedYear !== 'All' && String(pendingImportData.sourceYear) !== String(selectedYear)
                            ? "無法匯入：年份不符"
                            : `選擇${pendingImportData?.sourceYear || ''}要匯入的使用者`
                    }
                    description={
                        pendingImportData?.sourceYear && selectedYear !== 'All' && String(pendingImportData.sourceYear) !== String(selectedYear)
                            ? `匯入檔案年份 (${pendingImportData.sourceYear}) 與目前檢視年份 (${selectedYear}) 不符。為了確保數據一致性，請切換至正確年份後再進行匯入。`
                            : undefined
                    }
                    users={
                        pendingImportData?.sourceYear && selectedYear !== 'All' && String(pendingImportData.sourceYear) !== String(selectedYear)
                            ? [] // Empty
                            : selectionUsers
                    }
                    hideList={!!(pendingImportData?.sourceYear && selectedYear !== 'All' && String(pendingImportData.sourceYear) !== String(selectedYear))}
                    onlyConfirm={!!(pendingImportData?.sourceYear && selectedYear !== 'All' && String(pendingImportData.sourceYear) !== String(selectedYear))}
                    onConfirm={
                        pendingImportData?.sourceYear && selectedYear !== 'All' && String(pendingImportData.sourceYear) !== String(selectedYear)
                            ? (() => setImportSelectionOpen(false)) as any // Force cast if needed or adjust logic
                            : confirmImport
                    }
                    confirmLabel={
                        pendingImportData?.sourceYear && selectedYear !== 'All' && String(pendingImportData.sourceYear) !== String(selectedYear)
                            ? "我知道了"
                            : "開始匯入"
                    }
                    // New Props
                    processing={importProcessing}
                    progress={importProgress}
                    completedIds={completedImportIds}
                    preventCloseOnConfirm={true} // Keep open for processing
                    dependencies={{
                        'options_records': {
                            satisfied: (selected) => Array.from(selected).some(id => id !== 'market_data' && id !== 'options_records' && id !== 'interest_records')
                        },
                        'interest_records': {
                            satisfied: (selected) => Array.from(selected).some(id => id !== 'market_data' && id !== 'options_records' && id !== 'interest_records' && id !== 'fees_records')
                        },
                        'fees_records': {
                            satisfied: (selected) => Array.from(selected).some(id => id !== 'market_data' && id !== 'options_records' && id !== 'interest_records' && id !== 'fees_records')
                        }
                    }}
                />

                <ProgressDialog
                    open={progressOpen}
                    title="處理中"
                    description={progressMessage}
                    progress={progressValue}
                    onConfirm={progressValue === 100 ? () => setProgressOpen(false) : undefined}
                />
            </div>
        </TooltipProvider >
    );
}
