'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
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
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Pencil, Trash2, Download, Upload, FilterX, ArrowLeft } from 'lucide-react';
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
import { MultiSelect } from '@/components/ui/multi-select';

interface Deposit {
    id: number;
    deposit_date: number;
    user_id: number;
    amount: number;
    year: number;
    note: string | null;
    deposit_type: string;
    transaction_type: 'deposit' | 'withdrawal';
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
    return (
        <Suspense fallback={<div>Loading...</div>}>
            <DepositsPageContent />
        </Suspense>
    );
}

function DepositsPageContent() {
    const router = useRouter();
    const [deposits, setDeposits] = useState<Deposit[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [newDialogOpen, setNewDialogOpen] = useState(false);
    const [editingDeposit, setEditingDeposit] = useState<Deposit | null>(null);
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [depositToDelete, setDepositToDelete] = useState<number | null>(null);
    const [mounted, setMounted] = useState(false);
    const searchParams = useSearchParams();
    const initialYear = searchParams.get('year') || 'All';
    const [selectedYear, setSelectedYear] = useState(initialYear);
    const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
    const [selectedTransactionType, setSelectedTransactionType] = useState('All');
    const [selectedDepositType, setSelectedDepositType] = useState('All');
    const [userRole, setUserRole] = useState<string | null>(null);
    const [currentUserId, setCurrentUserId] = useState<number | null>(null);

    const { toast } = useToast();

    useEffect(() => {
        setMounted(true);
        fetchCurrentUser();
    }, []);

    const fetchCurrentUser = async () => {
        try {
            const res = await fetch('/api/auth/me');
            if (res.ok) {
                const data = await res.json();
                if (data.success && data.user) {
                    setUserRole(data.user.role);
                    setCurrentUserId(data.user.id);
                }
            }
        } catch (error) {
            console.error('Failed to fetch current user:', error);
        }
    };

    const fetchDeposits = async () => {
        try {
            const params = new URLSearchParams();

            if (selectedYear && selectedYear !== 'All') {
                params.append('year', selectedYear);
            }

            if (selectedUserIds.length > 0) {
                // Map selected string identifiers (user_id/email) back to all matching integer IDs
                const allMatchingIds = users
                    .filter(u => selectedUserIds.includes(u.user_id || u.email))
                    .map(u => u.id);
                if (allMatchingIds.length > 0) {
                    params.append('userId', allMatchingIds.join(','));
                }
            }

            if (selectedTransactionType && selectedTransactionType !== 'All') {
                params.append('transaction_type', selectedTransactionType);
            }

            if (selectedDepositType && selectedDepositType !== 'All') {
                params.append('deposit_type', selectedDepositType);
            }

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
        console.log('Fetching users...');
        try {
            const url = '/api/users?mode=selection&roles=customer';
            console.log('Fetching URL:', url);
            const res = await fetch(url, { cache: 'no-store' });
            if (!res.ok) {
                console.error('Fetch users failed status:', res.status, res.statusText);
                return;
            }
            const data = await res.json();
            console.log('Fetch users response:', data);
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
    }, [selectedYear, selectedUserIds, selectedTransactionType, selectedDepositType]);

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

    const formatDate = (timestamp: number) => {
        const date = new Date(timestamp * 1000);
        return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
    };

    const formatAmount = (amount: number) => {
        return new Intl.NumberFormat('zh-TW').format(amount);
    };

    const handleClearFilters = () => {
        setSelectedYear('All');
        setSelectedUserIds([]);
        setSelectedTransactionType('All');
        setSelectedDepositType('All');
    };

    // Calculate net total (deposits - withdrawals)
    const grandTotal = deposits.reduce((sum, d) => {
        if (d.transaction_type === 'withdrawal') {
            return sum - d.amount;
        }
        return sum + d.amount;
    }, 0);

    // Derive unique users for filter dropdown
    const uniqueUsers = Array.from(new Map(users.map(u => [u.user_id || u.email, u])).values());

    return (
        <TooltipProvider delayDuration={300}>
            <div className="container mx-auto py-10">
                <div className="w-full">
                    {/* Header */}
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-4">
                            <Button variant="ghost" size="icon" onClick={() => router.back()}>
                                <ArrowLeft className="h-6 w-6" />
                            </Button>
                            <h1 className="text-3xl font-bold tracking-tight">匯款記錄</h1>
                        </div>
                        <div className="flex items-center gap-4">
                            {/* Clear Filters Button */}
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        onClick={handleClearFilters}
                                        className="h-10 w-10 rounded-lg text-muted-foreground hover:text-primary"
                                    >
                                        <FilterX className="h-4 w-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p>清除所有過濾器</p>
                                </TooltipContent>
                            </Tooltip>

                            <Select value={selectedYear} onValueChange={setSelectedYear}>
                                <SelectTrigger className="w-[120px] focus:ring-0 focus:ring-offset-0">
                                    <SelectValue placeholder="選擇年份" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="All">全部年份</SelectItem>
                                    {Array.from({ length: new Date().getFullYear() - 2025 + 1 }, (_, i) => new Date().getFullYear() - i).map(year => (
                                        <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>

                            {/* Transaction Type Filter */}
                            <Select value={selectedTransactionType} onValueChange={setSelectedTransactionType}>
                                <SelectTrigger className="w-[120px] focus:ring-0 focus:ring-offset-0">
                                    <SelectValue placeholder="資金流動" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="All">全部匯款</SelectItem>
                                    <SelectItem value="deposit">入金</SelectItem>
                                    <SelectItem value="withdrawal">出金</SelectItem>
                                </SelectContent>
                            </Select>

                            <Select value={selectedDepositType} onValueChange={setSelectedDepositType}>
                                <SelectTrigger className="w-[120px] focus:ring-0 focus:ring-offset-0">
                                    <SelectValue placeholder="資產類型" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="All">全部類型</SelectItem>
                                    <SelectItem value="cash">現金</SelectItem>
                                    <SelectItem value="stock">股票</SelectItem>
                                </SelectContent>
                            </Select>

                            {/* Multi-Select User Filter - Hidden for customers */}
                            {userRole && userRole !== 'customer' && (
                                <MultiSelect
                                    options={uniqueUsers.map(user => ({
                                        value: user.user_id || user.email,
                                        label: user.user_id || user.email
                                    }))}
                                    selected={selectedUserIds}
                                    onChange={setSelectedUserIds}
                                    placeholder="選擇用戶"
                                    className="w-[200px]"
                                />
                            )}

                            {/* Admin/Manager only buttons */}
                            {userRole && ['admin', 'manager'].includes(userRole) && (
                                <>
                                    <Button
                                        onClick={() => setNewDialogOpen(true)}
                                        variant="secondary"
                                        className="hover:bg-accent hover:text-accent-foreground"
                                    >
                                        <span className="mr-0.5">+</span>新增
                                    </Button>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Deposits Table */}
                    {isLoading ? (
                        <div className="text-center py-12 text-muted-foreground">載入中...</div>
                    ) : deposits.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground bg-secondary/10 rounded-lg border border-dashed">
                            尚無匯款記錄
                        </div>
                    ) : (
                        <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-secondary hover:bg-secondary">
                                        <TableHead className="w-[70px] text-center">#</TableHead>
                                        <TableHead className="w-[140px] text-center">日期</TableHead>
                                        <TableHead className="w-[180px] text-center">用戶</TableHead>
                                        <TableHead className="w-[120px] text-center">資金流動</TableHead>
                                        <TableHead className="w-[160px] text-center">等價金額</TableHead>
                                        <TableHead className="w-[160px] text-center">類型</TableHead>
                                        <TableHead className="text-center">備註</TableHead>
                                        {userRole && ['admin', 'manager'].includes(userRole) && (
                                            <TableHead className="w-[100px] text-center"></TableHead>
                                        )}
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
                                            <TableCell className="text-center">
                                                <Badge
                                                    variant="secondary"
                                                    className={cn(
                                                        "font-normal",
                                                        deposit.transaction_type === 'withdrawal'
                                                            ? "bg-red-100 text-red-700 hover:bg-red-100"
                                                            : "bg-emerald-100 text-emerald-700 hover:bg-emerald-100"
                                                    )}
                                                >
                                                    {deposit.transaction_type === 'withdrawal' ? '出金' : '入金'}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-center">
                                                ${formatAmount(deposit.amount)}
                                            </TableCell>
                                            <TableCell className="text-center">
                                                {deposit.deposit_type === 'cash' ? '現金' : deposit.deposit_type === 'stock' ? '股票' : '股票+現金'}
                                            </TableCell>
                                            <TableCell className="text-center text-muted-foreground">
                                                {deposit.note || '-'}
                                            </TableCell>
                                            {userRole && ['admin', 'manager'].includes(userRole) && (
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
                                            )}
                                        </TableRow>
                                    ))}
                                    {/* Summary Row */}
                                    <TableRow className="bg-primary/5 font-semibold border-t-2">
                                        <TableCell colSpan={userRole && ['admin', 'manager'].includes(userRole) ? 7 : 6}></TableCell>
                                        <TableCell className="text-right font-semibold text-primary">
                                            總計 {grandTotal >= 0 ? '$' : '-$'}{formatAmount(Math.abs(grandTotal))}
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
