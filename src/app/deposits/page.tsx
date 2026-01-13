'use client';

import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { Pencil, Trash2, Download, Upload } from 'lucide-react';
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
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { NewDepositDialog } from '@/components/NewDepositDialog';
import { EditDepositDialog } from '@/components/EditDepositDialog';
import { useToast } from "@/hooks/use-toast";

interface Deposit {
    id: number;
    deposit_date: number;
    user_id: number;
    amount: number;
    year: number;
    note: string | null;
    deposit_type: string;
    depositor_user_id: string | null;
    depositor_email: string;
    created_at: number;
    updated_at: number;
}

interface User {
    id: number;
    user_id: string | null;
    email: string;
}

export default function DepositsPage() {
    const [deposits, setDeposits] = useState<Deposit[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [newDialogOpen, setNewDialogOpen] = useState(false);
    const [editingDeposit, setEditingDeposit] = useState<Deposit | null>(null);
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [depositToDelete, setDepositToDelete] = useState<number | null>(null);
    const [mounted, setMounted] = useState(false);
    const [selectedYear, setSelectedYear] = useState('All');
    const [selectedUserId, setSelectedUserId] = useState('All');
    const [importing, setImporting] = useState(false);

    const { toast } = useToast();

    useEffect(() => {
        setMounted(true);
    }, []);

    const fetchDeposits = async () => {
        try {
            const yearParam = selectedYear === 'All' ? '' : selectedYear;
            const userParam = selectedUserId === 'All' ? '' : selectedUserId;

            const params = new URLSearchParams();
            if (yearParam) params.append('year', yearParam);
            if (userParam) params.append('userId', userParam);

            const url = params.toString() ? `/api/deposits?${params.toString()}` : '/api/deposits';
            const res = await fetch(url, { cache: 'no-store' });
            const data = await res.json();
            if (data.success) {
                setDeposits(data.deposits);
            }
        } catch (error) {
            console.error('Failed to fetch deposits:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const fetchUsers = async () => {
        try {
            const res = await fetch('/api/users?mode=selection&roles=customer', { cache: 'no-store' });
            const data = await res.json();
            if (data.users) {
                setUsers(data.users);
            }
        } catch (error) {
            console.error('Failed to fetch users:', error);
        }
    };

    useEffect(() => {
        fetchDeposits();
        fetchUsers();
    }, [selectedYear, selectedUserId]);

    const handleEdit = (deposit: Deposit) => {
        setEditingDeposit(deposit);
        setEditDialogOpen(true);
    };

    const handleDelete = (id: number) => {
        setDepositToDelete(id);
    };

    const confirmDelete = async () => {
        if (!depositToDelete) return;

        try {
            const res = await fetch(`/api/deposits/${depositToDelete}`, {
                method: 'DELETE',
            });
            if (res.ok) {
                setDeposits(deposits.filter(d => d.id !== depositToDelete));
            }
        } catch (error) {
            console.error('Failed to delete deposit:', error);
        } finally {
            setDepositToDelete(null);
        }
    };

    const handleExport = async () => {
        try {
            const yearParam = selectedYear === 'All' ? '' : selectedYear;
            const userParam = selectedUserId === 'All' ? '' : selectedUserId;

            const params = new URLSearchParams();
            if (yearParam) params.append('year', yearParam);
            if (userParam) params.append('userId', userParam);

            const url = params.toString() ? `/api/deposits/export?${params.toString()}` : '/api/deposits/export';
            const res = await fetch(url);
            if (!res.ok) {
                throw new Error('匯出失敗');
            }

            const data = await res.json();

            const blob = new Blob([JSON.stringify(data.deposits, null, 2)], { type: 'application/json' });
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            const dateStr = new Date().toISOString().split('T')[0];
            a.download = `deposits_export_${dateStr}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(blobUrl);

            toast({
                title: "匯出成功",
                description: `已匯出 ${data.count} 筆入金記錄`,
            });
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "匯出失敗",
                description: error.message,
            });
        }
    };

    const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        try {
            setImporting(true);

            const text = await file.text();
            const deposits = JSON.parse(text);

            const res = await fetch('/api/deposits/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ deposits }),
            });

            const result = await res.json();

            if (!res.ok) {
                throw new Error(result.error || '匯入失敗');
            }

            toast({
                title: "匯入完成",
                description: `成功匯入 ${result.imported} 筆，跳過 ${result.skipped} 筆`,
            });

            fetchDeposits();
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "匯入失敗",
                description: error.message,
            });
        } finally {
            setImporting(false);
            event.target.value = '';
        }
    };

    const formatDate = (timestamp: number) => {
        const date = new Date(timestamp * 1000);
        return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
    };

    const formatAmount = (amount: number) => {
        return new Intl.NumberFormat('zh-TW').format(amount);
    };

    // Calculate total by user
    const userTotals = deposits.reduce((acc, deposit) => {
        const key = deposit.user_id;
        acc[key] = (acc[key] || 0) + deposit.amount;
        return acc;
    }, {} as Record<number, number>);

    const grandTotal = deposits.reduce((sum, d) => sum + d.amount, 0);

    return (
        <TooltipProvider delayDuration={300}>
            <div className="container mx-auto py-10">
                <div className="w-full">
                    {/* Header */}
                    <div className="flex items-center justify-between mb-6">
                        <h1 className="text-3xl font-bold">
                            入金記錄
                        </h1>
                        <div className="flex items-center gap-4">
                            <Select value={selectedYear} onValueChange={setSelectedYear}>
                                <SelectTrigger className="w-[120px]">
                                    <SelectValue placeholder="選擇年份" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="All">全部年份</SelectItem>
                                    {Array.from({ length: new Date().getFullYear() - 2025 + 1 }, (_, i) => new Date().getFullYear() - i).map(year => (
                                        <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                                <SelectTrigger className="w-[150px]">
                                    <SelectValue placeholder="選擇用戶" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="All">全部用戶</SelectItem>
                                    {users.map((user) => (
                                        <SelectItem key={user.id} value={user.id.toString()}>
                                            {user.user_id || user.email}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Button
                                onClick={handleExport}
                                variant="outline"
                                className="hover:bg-accent hover:text-accent-foreground"
                            >
                                <Download className="h-4 w-4 mr-2" />
                                匯出
                            </Button>
                            <Button
                                variant="outline"
                                onClick={() => document.getElementById('deposits-file-input')?.click()}
                                disabled={importing}
                            >
                                <Upload className="h-4 w-4 mr-2" />
                                {importing ? '匯入中...' : '匯入'}
                                <input
                                    type="file"
                                    id="deposits-file-input"
                                    accept=".json"
                                    style={{ display: 'none' }}
                                    onChange={handleImport}
                                />
                            </Button>
                            <Button
                                onClick={() => setNewDialogOpen(true)}
                                variant="secondary"
                                className="hover:bg-accent hover:text-accent-foreground"
                            >
                                <span className="mr-0.5">+</span>新增
                            </Button>
                        </div>
                    </div>

                    {/* Deposits Table */}
                    {isLoading ? (
                        <div className="text-center py-12 text-muted-foreground">載入中...</div>
                    ) : deposits.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground bg-secondary/10 rounded-lg border border-dashed">
                            尚無入金記錄
                        </div>
                    ) : (
                        <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-secondary hover:bg-secondary">
                                        <TableHead className="w-[70px] text-center">#</TableHead>
                                        <TableHead className="w-[140px] text-center">日期</TableHead>
                                        <TableHead className="w-[180px] text-center">用戶</TableHead>
                                        <TableHead className="w-[160px] text-center">金額</TableHead>
                                        <TableHead className="w-[160px] text-center">類型</TableHead>
                                        <TableHead className="text-center">備註</TableHead>
                                        <TableHead className="w-[100px] text-center"></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {deposits.map((deposit, index) => (
                                        <TableRow key={deposit.id} className="hover:bg-muted/50">
                                            <TableCell className="text-center text-muted-foreground font-mono">
                                                {deposits.length - index}
                                            </TableCell>
                                            <TableCell className="text-center font-medium">
                                                {formatDate(deposit.deposit_date)}
                                            </TableCell>
                                            <TableCell className="text-center">
                                                {deposit.depositor_user_id || deposit.depositor_email}
                                            </TableCell>
                                            <TableCell className="text-center font-semibold">
                                                ${formatAmount(deposit.amount)}
                                            </TableCell>
                                            <TableCell className="text-center">
                                                {deposit.deposit_type === 'cash' ? '現金' : deposit.deposit_type === 'stock' ? '股票' : '股票+現金'}
                                            </TableCell>
                                            <TableCell className="text-center text-muted-foreground">
                                                {deposit.note || '-'}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-1">
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                                                onClick={() => handleEdit(deposit)}
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
                                                                className="h-8 w-8 text-muted-foreground hover:text-red-600"
                                                                onClick={() => handleDelete(deposit.id)}
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </Button>
                                                        </TooltipTrigger>
                                                        <TooltipContent>
                                                            <p>刪除</p>
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                    {/* Summary Row */}
                                    <TableRow className="bg-primary/5 font-semibold border-t-2">
                                        <TableCell colSpan={6}></TableCell>
                                        <TableCell className="text-right text-primary">
                                            總計 ${formatAmount(grandTotal)}
                                        </TableCell>
                                    </TableRow>
                                </TableBody>
                            </Table>
                        </div>
                    )}

                    <NewDepositDialog
                        open={newDialogOpen}
                        onOpenChange={setNewDialogOpen}
                        onSuccess={fetchDeposits}
                        users={users}
                    />

                    {editingDeposit && (
                        <EditDepositDialog
                            deposit={editingDeposit}
                            open={editDialogOpen}
                            onOpenChange={setEditDialogOpen}
                            onSuccess={fetchDeposits}
                            users={users}
                        />
                    )}

                    <AlertDialog open={!!depositToDelete} onOpenChange={(open: boolean) => !open && setDepositToDelete(null)}>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>您確定要刪除嗎？</AlertDialogTitle>
                                <AlertDialogDescription>
                                    此操作無法復原。這將永久刪除此入金記錄。
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>取消</AlertDialogCancel>
                                <AlertDialogAction onClick={confirmDelete}>
                                    刪除
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </div>
            </div>
        </TooltipProvider>
    );
}
