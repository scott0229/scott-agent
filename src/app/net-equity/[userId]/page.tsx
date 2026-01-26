'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

import { Loader2, ArrowLeft, Star, Plus, Pencil, Trash2, FilterX } from "lucide-react";
import { cn } from "@/lib/utils";
import { NewNetEquityDialog } from '@/components/NewNetEquityDialog';
import { EditNetEquityDialog } from '@/components/EditNetEquityDialog';
import { useToast } from "@/hooks/use-toast";
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
import { useYearFilter } from '@/contexts/YearFilterContext';

interface PerformanceRecord {
    id: number;
    date: number;
    net_equity: number;
    cash_balance?: number | null;
    management_fee?: number | null;
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
    const [users, setUsers] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);
    const [userName, setUserName] = useState<string>('');
    const [initialCost, setInitialCost] = useState<number>(0);
    const [isNewDialogOpen, setIsNewDialogOpen] = useState(false);
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [recordToEdit, setRecordToEdit] = useState<PerformanceRecord | null>(null);
    const [recordToDelete, setRecordToDelete] = useState<number | null>(null);
    const [deleteAllOpen, setDeleteAllOpen] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const searchParams = useSearchParams();
    const [selectedMonth, setSelectedMonth] = useState<string>(searchParams.get('month') || 'all');
    const [filterType, setFilterType] = useState<string>(searchParams.get('type') || 'all');
    const [selectedUserValue, setSelectedUserValue] = useState<string>('');



    const { toast } = useToast();
    const { selectedYear } = useYearFilter();

    // ... (rest of the file until filteredRecords)

    // ... code lines omitted for brevity ...
    // Note: I cannot omit lines in ReplacementContent if I am replacing a block.
    // I need to be careful with the target block to avoiding replacing the whole file logic.
    // I will split this into two calls. One for State, one for Filter Logic.


    // Safe parsing of userId
    const userId = typeof params.userId === 'string' ? params.userId : '';

    useEffect(() => {
        if (userId) {
            checkAuthAndFetch();
        }
    }, [userId, selectedYear]);

    const checkAuthAndFetch = async () => {
        try {
            const authRes = await fetch('/api/auth/me');
            if (authRes.ok) {
                const authData = await authRes.json();
                setCurrentUserRole(authData.user?.role || null);
            }

            // Fetch user details for header name
            try {
                // Determine year - defaulting to current year or all doesn't matter much for basic profile
                // But we need to use a query that gets the user. 
                // Using selection mode with role filtering might be overkill but works if we can filter by ID.
                // Or just use the bulk fetch from net-equity API if we add user info there.
                // A better way: fetch from /api/users?mode=selection&userId=XXX if supported?
                // The API supports userId param in selection mode.
                // A better way: fetch from /api/users?mode=selection if specific ID fetch isn't supported by ID column
                // Removing userId param to fetch all selection candidates (customers) and then find by ID.
                const userRes = await fetch(`/api/users?mode=selection&roles=customer`);
                if (userRes.ok) {
                    const userData = await userRes.json();
                    if (userData.users && userData.users.length > 0) {
                        // Filter out admin user (usually id 1 or user_id 'admin')
                        // Assuming user_id or email check
                        const filteredUsers = userData.users.filter((u: any) => u.user_id !== 'admin' && u.email !== 'admin@example.com' && u.role !== 'admin');
                        filteredUsers.sort((a: any, b: any) => (b.current_net_equity || 0) - (a.current_net_equity || 0));
                        setUsers(filteredUsers);

                        // Find by DB ID or user_id or email
                        const user = userData.users.find((u: any) =>
                            u.id.toString() === userId ||
                            u.user_id === userId
                        );

                        if (user) {
                            const displayName = user.user_id || user.email.split('@')[0];
                            const selectorValue = user.user_id || user.email;
                            setUserName(displayName);
                            setSelectedUserValue(selectorValue);
                            setInitialCost((user as any).initial_cost || 0);
                        } else {
                            console.log("User not found in selection list", userId);
                            // Fallback to params.userId if not found ??
                            setSelectedUserValue(userId);
                        }
                    }
                }
            } catch (e) {
                console.error("Failed to fetch user name", e);
            }

            await fetchRecords();

        } catch (error) {
            console.error('Error:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const fetchRecords = async () => {
        try {
            const yearParam = selectedYear === 'All' ? '' : `&year=${selectedYear}`;
            const res = await fetch(`/api/net-equity?userId=${userId}${yearParam}`);
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





    const handleEdit = (record: PerformanceRecord) => {
        setRecordToEdit(record);
        setEditDialogOpen(true);
    };

    const handleDelete = (id: number) => {
        setRecordToDelete(id);
    };

    const confirmDelete = async () => {
        if (!recordToDelete) return;

        try {
            const res = await fetch('/api/net-equity', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: recordToDelete }),
            });

            if (res.ok) {

                fetchRecords();
            } else {
                toast({
                    variant: "destructive",
                    title: "刪除失敗",
                    description: "無法刪除淨值記錄",
                });
            }
        } catch (error) {
            console.error('Delete failed', error);
            toast({
                variant: "destructive",
                title: "錯誤",
                description: "發生錯誤，請稍後再試",
            });
        } finally {
            setRecordToDelete(null);
        }
    };

    const handleDeleteAll = async () => {
        setIsDeleting(true);
        try {
            const res = await fetch('/api/net-equity', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mode: 'all',
                    user_id: userId,
                    year: selectedYear
                    // Removed delete_benchmarks: true as QQQ/QLD are global shared data
                })
            });

            if (res.ok) {

                setDeleteAllOpen(false);
                fetchRecords(); // Refresh data
            } else {
                throw new Error("Failed to delete all");
            }
        } catch (e) {
            toast({ variant: "destructive", title: "刪除失敗", description: "無法刪除資料" });
        } finally {
            setIsDeleting(false);
        }
    };


    const filteredRecords = records.filter(record => {
        // 1. Month Filter
        if (selectedMonth !== 'all') {
            const recordDate = new Date(record.date * 1000);
            if ((recordDate.getMonth() + 1).toString() !== selectedMonth) {
                return false;
            }
        }

        // 2. Type Filter (Activity: Deposit or Fee or All)
        if (filterType === 'management_fee') {
            const hasFee = record.management_fee !== null && record.management_fee !== undefined && record.management_fee !== 0;
            if (!hasFee) return false;
        } else if (filterType === 'transfer') {
            const hasDeposit = (record as any).deposit && (record as any).deposit !== 0;
            if (!hasDeposit) return false;
        } else if (filterType === 'transfer') {
            const hasDeposit = (record as any).deposit && (record as any).deposit !== 0;
            if (!hasDeposit) return false;
        }

        return true;
    });

    if (isLoading) {
        return (
            <div className="flex h-screen items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    const resetFilters = () => {
        setSelectedMonth('all');
        setFilterType('all');
        // Clear URL params but keep the page
        router.push(`/net-equity/${userId}`);
    };

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
                    <h1 className="text-3xl font-bold flex items-center gap-2">
                        {selectedYear === 'All' ? '' : selectedYear} 淨值記錄
                        {isAdmin && users.length > 0 ? (
                            <>
                                <Select
                                    value={selectedUserValue || userId}
                                    onValueChange={(newId) => {
                                        const params = new URLSearchParams();
                                        if (selectedMonth !== 'all') params.set('month', selectedMonth);
                                        if (filterType !== 'all') params.set('type', filterType);

                                        const queryString = params.toString();
                                        const url = queryString ? `/net-equity/${newId}?${queryString}` : `/net-equity/${newId}`;
                                        router.push(url);
                                    }}
                                >
                                    <SelectTrigger className="w-auto min-w-[200px] h-auto px-3 py-2 text-3xl font-bold border border-input rounded-md bg-background gap-4 hover:bg-accent hover:text-accent-foreground transition-colors">
                                        <SelectValue placeholder="選擇用戶" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {users.map((user) => (
                                            <SelectItem key={user.id} value={user.user_id || user.email}>
                                                {user.user_id || user.email}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </>
                        ) : (
                            userName ? `- ${userName}` : ''
                        )}
                    </h1>
                </div>


                {isAdmin && (
                    <div className="flex items-center gap-2">
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        onClick={resetFilters}
                                        className="h-10 w-10 text-muted-foreground hover:text-primary mr-2"
                                    >
                                        <FilterX className="h-4 w-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p>重置篩選</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>

                        <Select value={filterType} onValueChange={setFilterType}>
                            <SelectTrigger className="w-[140px]">
                                <SelectValue placeholder="顯示全部" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">顯示全部</SelectItem>
                                <SelectItem value="management_fee">顯示管理費支出</SelectItem>
                                <SelectItem value="transfer">顯示轉帳記錄</SelectItem>
                            </SelectContent>
                        </Select>

                        <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                            <SelectTrigger className="w-[120px]">
                                <SelectValue placeholder="月份" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">全部月份</SelectItem>
                                <SelectItem value="1">1月</SelectItem>
                                <SelectItem value="2">2月</SelectItem>
                                <SelectItem value="3">3月</SelectItem>
                                <SelectItem value="4">4月</SelectItem>
                                <SelectItem value="5">5月</SelectItem>
                                <SelectItem value="6">6月</SelectItem>
                                <SelectItem value="7">7月</SelectItem>
                                <SelectItem value="8">8月</SelectItem>
                                <SelectItem value="9">9月</SelectItem>
                                <SelectItem value="10">10月</SelectItem>
                                <SelectItem value="11">11月</SelectItem>
                                <SelectItem value="12">12月</SelectItem>
                            </SelectContent>
                        </Select>

                        <Button
                            variant="outline"
                            className="gap-2 bg-[#F9F4EF] hover:bg-[#F0E6DD] text-[#4A3728] border-[#EAE0D5]"
                            onClick={() => setDeleteAllOpen(true)}
                        >
                            <Trash2 className="h-4 w-4" />
                            刪除全部
                        </Button>
                        <Button
                            className="gap-2 bg-[#EAE0D5] hover:bg-[#DBC9BA] text-[#4A3728] border-none"
                            onClick={() => setIsNewDialogOpen(true)}
                        >
                            <Plus className="h-4 w-4" />
                            新增
                        </Button>
                    </div>
                )}
            </div>

            <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-secondary/50 hover:bg-secondary/50">
                            <TableHead className="w-[100px] text-center font-bold text-foreground">交易日</TableHead>
                            <TableHead className="text-center font-bold text-foreground">帳戶淨值</TableHead>
                            <TableHead className="text-center font-bold text-foreground">帳戶現金</TableHead>
                            <TableHead className="text-center font-bold text-foreground">管理費支出</TableHead>
                            <TableHead className="text-center font-bold text-foreground">轉帳記錄</TableHead>
                            <TableHead className="text-center font-bold text-foreground">當日報酬率</TableHead>
                            <TableHead className="text-center font-bold text-foreground">淨值率</TableHead>
                            <TableHead className="text-center font-bold text-foreground">前高</TableHead>
                            <TableHead className="text-center font-bold text-foreground">回撤</TableHead>
                            <TableHead className="text-center font-bold text-foreground">新高記錄</TableHead>
                            {isAdmin && <TableHead className="text-right"></TableHead>}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredRecords.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={11} className="h-24 text-center text-muted-foreground">
                                    尚無記錄
                                </TableCell>
                            </TableRow>
                        )}
                        {filteredRecords.map((record) => (
                            <TableRow key={record.id} className="hover:bg-muted/50 h-9">
                                <TableCell className="text-center font-mono py-1">
                                    {formatDate(record.date)}
                                </TableCell>
                                <TableCell className="text-center py-1">
                                    <div className="flex justify-center">
                                        <Badge variant="secondary" className="bg-slate-100 text-slate-600 hover:bg-slate-100 border border-slate-200">
                                            {formatMoney(record.net_equity)}
                                        </Badge>
                                    </div>
                                </TableCell>
                                <TableCell className="text-center py-1">
                                    {record.cash_balance !== null && record.cash_balance !== undefined ? (
                                        formatMoney(record.cash_balance)
                                    ) : (
                                        <span className="text-muted-foreground">-</span>
                                    )}
                                </TableCell>
                                <TableCell className="text-center py-1">
                                    {record.management_fee !== null && record.management_fee !== undefined && record.management_fee !== 0 ? (
                                        formatMoney(record.management_fee)
                                    ) : (
                                        "0"
                                    )}
                                </TableCell>
                                <TableCell className="text-center font-mono py-1">
                                    {(record as any).deposit && (record as any).deposit !== 0 ? (
                                        formatMoney((record as any).deposit)
                                    ) : (
                                        "0"
                                    )}
                                </TableCell>
                                <TableCell className="text-center font-mono py-1">
                                    {formatPercent(record.daily_return)}
                                </TableCell>
                                <TableCell className="text-center font-mono py-1">
                                    {formatPercent(record.nav_ratio)}
                                </TableCell>
                                <TableCell className="text-center font-mono py-1">
                                    {formatPercent(record.running_peak)}
                                </TableCell>
                                <TableCell className="text-center font-mono py-1">
                                    {formatPercent(record.drawdown)}
                                </TableCell>
                                <TableCell className="text-center py-1">
                                    {record.is_new_high && (
                                        <div className="flex justify-center">
                                            <Star className="h-4 w-4 fill-yellow-400 text-yellow-500" />
                                        </div>
                                    )}
                                </TableCell>
                                {isAdmin && (
                                    <TableCell className="text-right py-1">
                                        <div className="flex justify-end gap-1">
                                            <TooltipProvider>
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => handleEdit(record)}
                                                            className="text-muted-foreground hover:text-primary hover:bg-primary/10"
                                                        >
                                                            <Pencil className="h-4 w-4" />
                                                        </Button>
                                                    </TooltipTrigger>
                                                    <TooltipContent>
                                                        <p>編輯</p>
                                                    </TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>

                                            <TooltipProvider>
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => setRecordToDelete(record.id)}
                                                            className="text-muted-foreground hover:text-red-600 hover:bg-red-50"
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    </TooltipTrigger>
                                                    <TooltipContent>
                                                        <p>刪除</p>
                                                    </TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>
                                        </div>
                                    </TableCell>
                                )}
                            </TableRow>
                        ))}
                        {/* Initial Cost Row - Always Visible */}
                        <TableRow className="bg-muted/30 hover:bg-muted/50 font-medium">
                            <TableCell className="text-center font-mono">
                                年初淨值
                            </TableCell>
                            <TableCell className="text-center">
                                <div className="flex justify-center">
                                    <Badge variant="secondary" className="bg-slate-100 text-slate-600 hover:bg-slate-100 border border-slate-200">
                                        {formatMoney(initialCost)}
                                    </Badge>
                                </div>
                            </TableCell>
                            <TableCell className="text-center font-mono font-normal">0</TableCell>
                            <TableCell className="text-center font-mono font-normal">
                                {(() => {
                                    const sum = records.reduce((s, r) => s + (r.management_fee || 0), 0);
                                    if (sum === 0) return '';
                                    return formatMoney(sum);
                                })()}
                            </TableCell>
                            <TableCell className="text-center font-mono font-normal">
                                {(() => {
                                    const sum = records.reduce((s, r) => s + (r.daily_deposit || 0), 0);
                                    if (sum === 0) return '';
                                    return formatMoney(sum);
                                })()}
                            </TableCell>
                            <TableCell colSpan={6} className="text-center"></TableCell>
                        </TableRow>
                    </TableBody>
                </Table>
            </div >

            <NewNetEquityDialog
                open={isNewDialogOpen}
                onOpenChange={setIsNewDialogOpen}
                userId={parseInt(userId)}
                year={selectedYear}
                onSuccess={fetchRecords}
            />

            <EditNetEquityDialog
                open={editDialogOpen}
                onOpenChange={(open) => {
                    setEditDialogOpen(open);
                    if (!open) setRecordToEdit(null);
                }}
                recordToEdit={recordToEdit}
                onSuccess={fetchRecords}
            />

            <AlertDialog open={!!recordToDelete} onOpenChange={(open) => !open && setRecordToDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>確定要刪除嗎？</AlertDialogTitle>
                        <AlertDialogDescription>
                            此動作無法復原。這將永久刪除此淨值記錄，並影響績效指標的計算。
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

            {/* Delete All Confirmation Dialog */}
            <AlertDialog open={deleteAllOpen} onOpenChange={setDeleteAllOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>確定要刪除全部資料嗎？</AlertDialogTitle>
                        <AlertDialogDescription>
                            此動作將刪除 {selectedYear} 年該使用者的所有淨值記錄。<br />
                            <span className="text-destructive font-bold">此動作無法復原。</span>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isDeleting}>取消</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDeleteAll} disabled={isDeleting} className="bg-destructive hover:bg-destructive/90">
                            {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "確認刪除"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div >
    );
}
