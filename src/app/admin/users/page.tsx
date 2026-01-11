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
import { Pencil, Trash2 } from "lucide-react";
import { useYearFilter } from '@/contexts/YearFilterContext';

interface User {
    id: number;
    email: string;
    user_id: string | null;
    role: string;
    management_fee?: number;
    ib_account?: string;
    phone?: string;
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
    const { toast } = useToast();
    const router = useRouter();
    const { selectedYear } = useYearFilter();

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
        fetchUsers();
    }, [selectedYear]); // Add selectedYear dependency

    const handleDelete = async (id: number) => {
        setUserToDelete(id);
    };

    const confirmDelete = async () => {
        if (!userToDelete) return;

        try {
            // Delete all transactions for this user in the selected year
            const res = await fetch(`/api/users/transactions?userId=${userToDelete}&year=${selectedYear}`, {
                method: 'DELETE',
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to delete');
            }

            toast({
                title: "已移除",
                description: selectedYear === 'All'
                    ? "該客戶的所有交易紀錄已刪除"
                    : `該客戶在 ${selectedYear} 年的交易紀錄已刪除`,
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

    const getRoleBadge = (role: string) => {
        switch (role) {
            case 'admin':
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

    return (
        <TooltipProvider delayDuration={300}>
            <div className="container mx-auto py-10">
                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-3xl font-bold">使用者管理</h1>
                    <Button
                        onClick={() => { setEditingUser(null); setDialogOpen(true); }}
                        variant="secondary"
                        className="hover:bg-accent hover:text-accent-foreground"
                    >
                        新增使用者
                    </Button>
                </div>

                <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-secondary hover:bg-secondary">
                                <TableHead className="w-[50px] text-center">#</TableHead>
                                <TableHead className="text-center">帳號</TableHead>
                                <TableHead className="text-center">角色</TableHead>
                                <TableHead className="text-center">管理費</TableHead>
                                <TableHead className="text-center">交易帳號</TableHead>
                                <TableHead className="text-center">手機號碼</TableHead>
                                <TableHead>郵件地址</TableHead>
                                <TableHead className="text-right"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {users.filter(u => u.email !== 'admin').map((user, index) => (
                                <TableRow key={user.id}>
                                    <TableCell className="text-center text-muted-foreground font-mono">{index + 1}</TableCell>
                                    <TableCell className="text-center">{user.user_id || '-'}</TableCell>
                                    <TableCell className="text-center">{getRoleBadge(user.role)}</TableCell>
                                    <TableCell className="text-center">{user.role === 'customer' ? `${user.management_fee}%` : '-'}</TableCell>
                                    <TableCell className="text-center">{user.role === 'customer' ? (user.ib_account || '-') : '-'}</TableCell>
                                    <TableCell className="text-center">{formatPhoneNumber(user.phone)}</TableCell>
                                    <TableCell>{user.email}</TableCell>
                                    <TableCell className="text-right">
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
                                    </TableCell>
                                </TableRow>
                            ))}
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
                                {selectedYear === 'All'
                                    ? '確定要刪除該客戶的所有交易記錄嗎？'
                                    : `確定要刪除該客戶在 ${selectedYear} 年的交易記錄嗎？`}
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                                {selectedYear === 'All'
                                    ? '此操作將刪除該客戶的所有交易記錄，客戶將從所有年份中移除。'
                                    : `此操作將刪除該客戶在 ${selectedYear} 年的所有交易記錄，客戶將從 ${selectedYear} 年列表中移除，但其他年份的記錄不受影響。`}
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
            </div>
        </TooltipProvider>
    );
}
