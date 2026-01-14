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
import { Pencil, Trash2, Download, Upload } from "lucide-react";
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
    const [importing, setImporting] = useState(false);
    const [mounted, setMounted] = useState(false);
    const [currentUser, setCurrentUser] = useState<{ role: string } | null>(null);
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

    const handleExport = async () => {
        try {
            const res = await fetch('/api/users/export');
            if (!res.ok) {
                throw new Error('匯出失敗');
            }

            const data = await res.json();

            // Create JSON blob and download
            const blob = new Blob([JSON.stringify(data.users, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const dateStr = new Date().toISOString().split('T')[0];
            a.download = `users_export_${dateStr}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            toast({
                title: "匯出成功",
                description: `已匯出 ${data.count} 位使用者`,
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
            const users = JSON.parse(text);

            const res = await fetch('/api/users/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ users }),
            });

            const result = await res.json();

            if (!res.ok) {
                throw new Error(result.error || '匯入失敗');
            }

            toast({
                title: "匯入完成",
                description: `成功匯入 ${result.imported} 位使用者，跳過 ${result.skipped} 位`,
            });

            fetchUsers();
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "匯入失敗",
                description: error.message,
            });
        } finally {
            setImporting(false);
            // Reset file input
            event.target.value = '';
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

    return (
        <TooltipProvider delayDuration={300}>
            <div className="container mx-auto py-10">
                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-3xl font-bold">
                        {mounted ? (selectedYear === 'All' ? new Date().getFullYear() : selectedYear) : ''} 帳號管理
                    </h1>
                    <div className="flex gap-2">
                        {currentUser?.role !== 'trader' && (
                            <>
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
                                    className="hover:bg-accent hover:text-accent-foreground relative"
                                    disabled={importing}
                                >
                                    <Upload className="h-4 w-4 mr-2" />
                                    {importing ? '匯入中...' : '匯入'}
                                    <input
                                        type="file"
                                        accept=".json"
                                        onChange={handleImport}
                                        className="absolute inset-0 opacity-0 cursor-pointer"
                                        disabled={importing}
                                    />
                                </Button>
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
                                    <TableCell className="text-center">{getRoleBadge(user.role)}</TableCell>
                                    <TableCell className="text-center">{user.user_id || '-'}</TableCell>
                                    <TableCell className="text-center">{user.role === 'customer' ? `${user.management_fee}%` : '-'}</TableCell>
                                    <TableCell className="text-center">{user.role === 'customer' ? (user.ib_account || '-') : '-'}</TableCell>
                                    <TableCell className="text-center">{formatPhoneNumber(user.phone)}</TableCell>
                                    <TableCell>{user.email}</TableCell>
                                    <TableCell className="text-right">
                                        {currentUser?.role !== 'trader' && (
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
            </div>
        </TooltipProvider>
    );
}
