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
import { Pencil, Trash2, Download, Upload, Wallet } from "lucide-react";
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

    // New State for Selection/Progress
    const [exportSelectionOpen, setExportSelectionOpen] = useState(false);
    const [importSelectionOpen, setImportSelectionOpen] = useState(false);
    const [progressOpen, setProgressOpen] = useState(false);
    const [progressValue, setProgressValue] = useState(0);
    const [progressMessage, setProgressMessage] = useState("");

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

    const fetchUsers = async () => {
        setLoading(true);
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
        } catch (error) {
            console.error('Failed to fetch users', error);
        } finally {
            setLoading(false);
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

            toast({
                title: "已刪除",
                description: "使用者已成功刪除",
            });
            fetchUsers();
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
        const exportableUsers = users
            .filter(u => u.email !== 'admin')
            .map(u => ({
                id: u.id,
                display: `${u.user_id || u.email.split('@')[0]} (${u.ib_account || 'No IB'})`,
                checked: true
            }));

        setSelectionUsers(exportableUsers);
        setExportSelectionOpen(true);
    };

    const confirmExport = async (selectedIds: (number | string)[]) => {
        setExportSelectionOpen(false);
        try {
            setProgressMessage("準備資料中...");
            setProgressValue(0);
            setProgressOpen(true);

            // Simulate progress start
            setProgressValue(10);

            const year = selectedYear === 'All' ? new Date().getFullYear() : selectedYear;

            // Call POST endpoint with selected IDs
            const res = await fetch('/api/users/export', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    year: selectedYear, // Pass 'All' or specific year directly
                    userIds: selectedIds
                })
            });

            setProgressValue(50);

            if (!res.ok) {
                throw new Error('匯出失敗');
            }

            const data = await res.json();
            setProgressValue(100);

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

            URL.revokeObjectURL(url);

            setProgressMessage("匯出完成");
            // setTimeout(() => setProgressOpen(false), 500); // Removed auto-close

            toast({
                title: "匯出成功",
                description: `已匯出 ${data.count} 位使用者`,
            });
        } catch (error: any) {
            setProgressOpen(false);
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
                usersList = data; // Legacy format? Or simple array
                // We better assume standard format { users: [], market_prices: [] }
                // But previous code handled array.
                // Let's wrap.
                setPendingImportData({ users: data });
            } else {
                usersList = data.users || [];
                setPendingImportData(data);
            }

            if (!usersList || usersList.length === 0) {
                throw new Error("檔案中沒有使用者資料");
            }

            const importableUsers = usersList.map((u: any, idx: number) => ({
                id: u.email, // Use email as unique key for selection
                display: `${u.user_id || u.email.split('@')[0]} (${u.ib_account || 'No IB'}) - ${u.year || ''}`,
                checked: true
            }));

            setSelectionUsers(importableUsers);
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
        setImportSelectionOpen(false);
        if (!pendingImportData) return;

        try {
            setProgressOpen(true);
            setProgressMessage("正在分析資料...");
            setProgressValue(5);

            const allUsers = pendingImportData.users || [];
            // Filter users based on selection
            // selectedIds contains emails (as strings)
            const selectedUsers = allUsers.filter((u: any) => selectedIds.includes(u.email));

            // Prepare Payload Structure
            const marketPrices = pendingImportData.market_prices || [];
            const sourceYear = pendingImportData.sourceYear;

            const targetYear = selectedYear === 'All' ? 'All' : selectedYear;

            // Step 1: Upload Market Prices (if any) - 10% progress
            if (marketPrices.length > 0) {
                setProgressMessage(`匯入市場數據 (${marketPrices.length} 筆)...`);
                // Use a separate dummy call or just include in first batch?
                // The current API handles both.
                // To support progress, we should probably upload market prices separately or just once.
                // Let's send market prices with the FIRST batch of users.
            }

            // Step 2: Batch Upload Users
            const TOTAL = selectedUsers.length;
            const BATCH_SIZE = 5; // Import 5 users at a time
            let processed = 0;
            let totalImported = 0;
            let totalSkipped = 0;
            let errors: string[] = [];

            for (let i = 0; i < TOTAL; i += BATCH_SIZE) {
                const chunk = selectedUsers.slice(i, i + BATCH_SIZE);

                // Only include market_prices in the VERY FIRST Request to avoid re-processing
                const chunkPayload = {
                    users: chunk,
                    market_prices: (i === 0) ? marketPrices : [],
                    sourceYear: sourceYear
                };

                setProgressMessage(`正在匯入使用者 (${i + 1} ~ ${Math.min(i + BATCH_SIZE, TOTAL)} / ${TOTAL})...`);

                const res = await fetch(`/api/users/import?targetYear=${targetYear}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(chunkPayload),
                });

                const result = await res.json();

                if (!res.ok) {
                    throw new Error(result.error || `Batch ${i} failed`);
                }

                totalImported += (result.imported || 0) + (result.updated || 0); // Count updates as imported for user perspective
                totalSkipped += (result.skipped || 0);
                if (result.errors) errors.push(...result.errors);

                processed += chunk.length;
                const percent = 10 + Math.round((processed / TOTAL) * 90); // Map 0-100% of users to 10-100% of bar
                setProgressValue(percent);
            }

            setProgressValue(100);
            setProgressMessage("匯入完成");
            // setTimeout(() => setProgressOpen(false), 800);

            toast({
                title: "匯入完成",
                description: `成功處理 ${totalImported} 位，跳過 ${totalSkipped} 位`,
            });

            setPendingImportData(null);
            fetchUsers();

        } catch (error: any) {
            setProgressOpen(false);
            toast({
                variant: "destructive",
                title: "匯入失敗",
                description: error.message,
            });
        }
    };

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
            toast({
                title: "已刪除全部",
                description: `已成功刪除 ${data.count} 位使用者`,
            });
            fetchUsers();
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
                        {mounted ? (selectedYear === 'All' ? new Date().getFullYear() : selectedYear) : ''} 帳號管理
                    </h1>
                    <div className="flex gap-2">
                        {/* Only show actions for admin/manager/trader, NOT customer */}
                        {currentUser?.role !== 'customer' && currentUser?.role !== 'trader' && (
                            <>
                                <Button
                                    onClick={() => {
                                        const year = selectedYear === 'All' ? new Date().getFullYear() : selectedYear;
                                        router.push(`/deposits?year=${year}`);
                                    }}
                                    variant="outline"
                                    className="hover:bg-accent hover:text-accent-foreground"
                                >
                                    <Wallet className="h-4 w-4 mr-2" />
                                    匯款記錄
                                </Button>
                                <Button
                                    onClick={handleExportClick}
                                    variant="outline"
                                    className="hover:bg-accent hover:text-accent-foreground"
                                >
                                    <Download className="h-4 w-4 mr-2" />
                                    匯出
                                </Button>
                                <Button
                                    variant="outline"
                                    className="hover:bg-accent hover:text-accent-foreground relative"
                                    disabled={importing}
                                >
                                    <Upload className="h-4 w-4 mr-2" />
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
                                <TableHead className="text-center">管理費</TableHead>
                                <TableHead className="text-center">年度匯款</TableHead>
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
                                            <TableCell colSpan={9} className="p-4">
                                                <div className="text-center py-12 text-muted-foreground bg-secondary/10 rounded-lg border border-dashed">
                                                    尚無客戶資料
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    );
                                }

                                return filteredUsers.map((user, index) => (
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
                                        <TableCell className="text-center">{user.role === 'customer' ? formatMoney(user.net_deposit || 0) : '-'}</TableCell>
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
                                ));
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
                />

                <UserSelectionDialog
                    open={importSelectionOpen}
                    onOpenChange={setImportSelectionOpen}
                    title={
                        pendingImportData?.sourceYear && selectedYear !== 'All' && String(pendingImportData.sourceYear) !== String(selectedYear)
                            ? "無法匯入：年份不符"
                            : "選擇要匯入的使用者"
                    }
                    description={
                        pendingImportData?.sourceYear && selectedYear !== 'All' && String(pendingImportData.sourceYear) !== String(selectedYear)
                            ? `匯入檔案年份 (${pendingImportData.sourceYear}) 與目前檢視年份 (${selectedYear}) 不符。為了確保數據一致性，請切換至正確年份後再進行匯入。`
                            : `目標年度：${selectedYear} | 來源年份：${pendingImportData?.sourceYear || '未知'}`
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
                            ? () => setImportSelectionOpen(false)
                            : confirmImport
                    }
                    confirmLabel={
                        pendingImportData?.sourceYear && selectedYear !== 'All' && String(pendingImportData.sourceYear) !== String(selectedYear)
                            ? "我知道了"
                            : "開始匯入"
                    }
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
