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
import { Badge } from "@/components/ui/badge";
import { NewOptionDialog } from "@/components/NewOptionDialog";
import { EditOptionDialog } from "@/components/EditOptionDialog";
import { ArrowLeft, FilterX, Pencil, Trash, Trash2 } from 'lucide-react';
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useRouter, useSearchParams } from 'next/navigation';
import { useYearFilter } from '@/contexts/YearFilterContext';

interface Option {
    id: number;
    status: string;
    operation: string | null;
    open_date: number;
    to_date: number | null;
    settlement_date: number | null;
    quantity: number;
    underlying: string;
    type: string;
    strike_price: number;
    collateral: number | null;
    premium: number | null;
    final_profit: number | null;
    profit_percent: number | null;
    delta: number | null;
    iv: number | null;
    capital_efficiency: number | null;
    user_id: string | null;
    code?: string;
}

export default function ClientOptionsPage({ params }: { params: { userId: string } }) {
    const [options, setOptions] = useState<Option[]>([]);
    const [users, setUsers] = useState<any[]>([]);
    const [selectedUserValue, setSelectedUserValue] = useState<string>('');
    const [isLoading, setIsLoading] = useState(true);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [isDeleteAllOpen, setIsDeleteAllOpen] = useState(false);
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [optionToEdit, setOptionToEdit] = useState<Option | null>(null);

    const [optionToDelete, setOptionToDelete] = useState<number | null>(null);

    // Use global year filter instead of local state
    const { selectedYear, setSelectedYear } = useYearFilter();
    const searchParams = useSearchParams();
    // Initialize to 'All' to avoid hydration mismatch, useEffect will sync from URL
    const [selectedMonth, setSelectedMonth] = useState<string>('All');
    const [selectedUnderlying, setSelectedUnderlying] = useState<string>('All');
    const [selectedType, setSelectedType] = useState<string>('All');
    const [selectedStatus, setSelectedStatus] = useState<string>('All');
    const [selectedOperation, setSelectedOperation] = useState<string>('All');

    const [ownerId, setOwnerId] = useState<number | null>(null);
    const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);

    const { toast } = useToast();
    const router = useRouter();

    // Sync filters with URL params
    useEffect(() => {
        const status = searchParams.get('status');
        console.log('[DEBUG] Syncing filters from URL - status:', status);
        setSelectedStatus(status || 'All');

        const month = searchParams.get('month');
        setSelectedMonth(month || 'All');

        const underlying = searchParams.get('underlying');
        setSelectedUnderlying(underlying || 'All');

        const type = searchParams.get('type');
        setSelectedType(type || 'All');

        const operation = searchParams.get('operation');
        setSelectedOperation(operation || 'All');

        console.log('[DEBUG] After sync - selectedStatus will be:', status || 'All');
    }, [searchParams]);

    useEffect(() => {
        const fetchUserAndCheckRole = async () => {
            try {
                // Fetch current user role
                const authRes = await fetch('/api/auth/me');
                if (authRes.ok) {
                    const authData = await authRes.json();
                    setCurrentUserRole(authData.user?.role || null);
                }

                // Fetch page owner user
                const yearForUser = selectedYear === 'All' ? new Date().getFullYear() : selectedYear;
                const yearParam = selectedYear === 'All' ? '' : `&year=${selectedYear}`;
                // Fetch all users for selection with year filtering
                const res = await fetch(`/api/users?mode=selection${yearParam}`, {
                    credentials: 'include'
                });
                const data = await res.json();
                if (data.users && data.users.length > 0) {
                    // Filter out admin user
                    let filteredUsers = data.users.filter((u: any) => u.user_id !== 'admin' && u.email !== 'admin@example.com' && u.role !== 'admin');

                    // Deduplicate by user_id/email if multiple users (e.g. across years) have same ID
                    const seen = new Set();
                    filteredUsers = filteredUsers.filter((u: any) => {
                        const key = u.user_id || u.email;
                        if (seen.has(key)) return false;
                        seen.add(key);
                        return true;
                    });

                    filteredUsers.sort((a: any, b: any) => (b.current_net_equity || 0) - (a.current_net_equity || 0));
                    setUsers(filteredUsers);
                    // Find current owner
                    const currentOwner = data.users.find((u: any) => u.id.toString() === params.userId || u.user_id === params.userId);
                    if (currentOwner) {
                        setOwnerId(currentOwner.id);
                        setSelectedUserValue(currentOwner.user_id || currentOwner.email);
                    } else {
                        // Fallback
                        setSelectedUserValue(params.userId);
                    }
                }
            } catch (error) {
                console.error('Failed to fetch user:', error);
            }
        };
        fetchUserAndCheckRole();
    }, [params.userId, selectedYear]);

    const handleDeleteAll = async () => {
        try {
            const res = await fetch(`/api/options?userId=${params.userId}&year=${selectedYear}`, {
                method: 'DELETE',
            });

            if (!res.ok) throw new Error('Failed to delete all options');

            await fetchOptions();
            setIsDeleteAllOpen(false);
        } catch (error) {
            console.error('Delete all error:', error);
            alert('刪除失敗');
        }
    };

    const fetchOptions = async () => {
        try {
            const year = selectedYear; // Allow 'All' to be passed directly
            // Prioritize ownerId if available
            // If params.userId is 'All', we don't pass userId or ownerId to get all records
            let idParam = '';
            if (params.userId !== 'All') {
                idParam = ownerId ? `ownerId=${ownerId}` : `userId=${params.userId}`;
            }
            // If idParam is empty, we just pass year. URLSearchParams handles empty keys mostly fine but let's be clean.
            const queryParams = [idParam, `year=${year}`].filter(Boolean).join('&');

            const res = await fetch(`/api/options?${queryParams}`, { cache: 'no-store' });
            const data = await res.json();
            if (data.options) {
                setOptions(data.options);
            }
        } catch (error) {
            console.error('Failed to fetch options:', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchOptions();
    }, [params.userId, selectedYear, ownerId]);

    const handleEdit = (option: Option) => {
        setOptionToEdit(option);
        setEditDialogOpen(true);
    };

    const handleDelete = (id: number) => {
        setOptionToDelete(id);
    };

    const confirmDelete = async () => {
        if (!optionToDelete) return;

        try {
            const res = await fetch(`/api/options/${optionToDelete}`, {
                method: 'DELETE',
            });

            if (res.ok) {

                fetchOptions();
            } else {
                toast({
                    variant: "destructive",
                    title: "刪除失敗",
                    description: "無法刪除交易紀錄",
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
            setOptionToDelete(null);
        }
    };



    // --- Helpers & Filter Logic (Same as before) ---
    const formatDate = (timestamp: number | null) => {
        if (!timestamp) return '';
        const date = new Date(timestamp * 1000);
        const year = date.getFullYear().toString().slice(-2);
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const calculateDays = (start: number, end: number | null) => {
        if (!end) return '';
        const diffTime = Math.abs(end * 1000 - start * 1000);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays;
    };

    const getDaysHeld = (opt: Option) => {
        if (!opt.settlement_date) return '';
        return calculateDays(opt.open_date, opt.settlement_date);
    }

    const getDaysToExpire = (opt: Option) => {
        if (!opt.to_date) return '';
        return calculateDays(opt.open_date, opt.to_date);
    };

    const resetFilters = () => {
        // Note: selectedYear is managed globally via navbar, not reset here
        setSelectedMonth('All');
        setSelectedUnderlying('All');
        setSelectedType('All');
        setSelectedStatus('All');
        setSelectedOperation('All');
    };

    // Derived State for Filters
    const years = Array.from(new Set(options.map(opt => new Date(opt.open_date * 1000).getFullYear()))).sort((a, b) => b - a);
    const months = Array.from({ length: 12 }, (_, i) => i + 1);
    const underlyings = Array.from(new Set(options.map(opt => opt.underlying))).sort();
    const statuses = Array.from(new Set(options.map(opt => opt.status))).sort();
    const operations = Array.from(new Set(options.map(opt => opt.operation || '持有中'))).sort();

    const filteredOptions = options.filter(opt => {
        const date = new Date(opt.open_date * 1000);
        // Year filter is handled by API query based on selectedYear
        const monthMatch = selectedMonth === 'All' || (date.getMonth() + 1).toString() === selectedMonth;
        const underlyingMatch = selectedUnderlying === 'All' || opt.underlying === selectedUnderlying;
        const typeMatch = selectedType === 'All' || opt.type === selectedType;
        const statusMatch = selectedStatus === 'All' || opt.status === selectedStatus;
        const operationMatch = selectedOperation === 'All' || (opt.operation || '持有中') === selectedOperation;
        return monthMatch && underlyingMatch && typeMatch && statusMatch && operationMatch;
    });

    // Sort options: open positions (持有中) first (by open_date desc), then closed positions (by open_date desc)
    const sortedOptions = filteredOptions.sort((a, b) => {
        const aIsOpen = (a.operation || '持有中') === '持有中';
        const bIsOpen = (b.operation || '持有中') === '持有中';

        // If one is open and the other is closed, open comes first
        if (aIsOpen && !bIsOpen) return -1;
        if (!aIsOpen && bIsOpen) return 1;

        // If both have the same status, sort by open_date (newest first)
        return b.open_date - a.open_date;
    });

    return (
        <div className="container mx-auto py-10 max-w-[1600px]">
            <div className="flex items-center gap-4 mb-6">
                {/* Only show back button for non-customer roles */}
                {currentUserRole && currentUserRole !== 'customer' && (
                    <Button variant="ghost" size="icon" onClick={() => router.push('/options')}>
                        <ArrowLeft className="h-6 w-6" />
                    </Button>
                )}
                <h1 className="text-3xl font-bold flex items-center gap-2">
                    期權交易
                    {currentUserRole && currentUserRole !== 'customer' && users.length > 0 ? (
                        <>
                            <Select
                                value={selectedUserValue || params.userId}
                                onValueChange={(newId) => {
                                    const params = new URLSearchParams();
                                    if (selectedMonth !== 'All') params.set('month', selectedMonth);
                                    if (selectedUnderlying !== 'All') params.set('underlying', selectedUnderlying);
                                    if (selectedType !== 'All') params.set('type', selectedType);
                                    if (selectedStatus !== 'All') params.set('status', selectedStatus);
                                    if (selectedOperation !== 'All') params.set('operation', selectedOperation);

                                    const queryString = params.toString();
                                    const url = queryString ? `/options/${newId}?${queryString}` : `/options/${newId}`;
                                    router.push(url);
                                }}
                            >
                                <SelectTrigger className="w-auto min-w-[200px] h-auto px-3 py-2 text-3xl font-bold border border-input rounded-md bg-background gap-4 hover:bg-accent hover:text-accent-foreground transition-colors">
                                    <SelectValue placeholder="選擇用戶" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="All">所有用戶</SelectItem>
                                    {users.map((user) => (
                                        <SelectItem key={user.id} value={user.user_id || user.email}>
                                            {user.user_id || user.email}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </>
                    ) : (
                        ` - ${params.userId}`
                    )}
                </h1>
                <div className="ml-auto flex items-center gap-4">
                    {/* Filter Controls */}
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

                        {/* Year filter removed - using global navbar year selector */}
                        <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                            <SelectTrigger className="w-[100px] focus:ring-0 focus:ring-offset-0"><SelectValue placeholder="月份" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="All">全部月份</SelectItem>
                                {months.map(month => <SelectItem key={month} value={month.toString()}>{month}月</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <Select value={selectedUnderlying} onValueChange={setSelectedUnderlying}>
                            <SelectTrigger className="w-[120px] focus:ring-0 focus:ring-offset-0"><SelectValue placeholder="底層標的" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="All">全部標的</SelectItem>
                                {underlyings.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <Select value={selectedType} onValueChange={setSelectedType}>
                            <SelectTrigger className="w-[100px] focus:ring-0 focus:ring-offset-0"><SelectValue placeholder="多空" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="All">全部類型</SelectItem>
                                <SelectItem value="CALL">CALL</SelectItem>
                                <SelectItem value="PUT">PUT</SelectItem>
                            </SelectContent>
                        </Select>
                        <Select value={selectedOperation} onValueChange={setSelectedOperation}>
                            <SelectTrigger className="w-[100px] focus:ring-0 focus:ring-offset-0"><SelectValue placeholder="操作" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="All">全部操作</SelectItem>
                                {operations.map(op => <SelectItem key={op} value={op}>{op}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>

                    {currentUserRole && currentUserRole !== 'customer' && (
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                className="flex gap-2 hover:bg-red-50 hover:text-red-600 hover:border-red-600"
                                onClick={() => setIsDeleteAllOpen(true)}
                            >
                                <Trash className="h-4 w-4" />
                                刪除全部
                            </Button>
                            <Button
                                onClick={() => setDialogOpen(true)}
                                variant="secondary"
                                className="hover:bg-accent hover:text-accent-foreground"
                            >
                                <span className="mr-0.5">+</span>新增
                            </Button>
                        </div>
                    )}
                </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border overflow-x-auto">
                <Table className="whitespace-nowrap">
                    <TableHeader>
                        <TableRow className="bg-secondary hover:bg-secondary">
                            {/* Table Headers same as original */}
                            <TableHead className="text-center">No.</TableHead>
                            {params.userId === 'All' && <TableHead className="text-center">用戶</TableHead>}
                            <TableHead className="text-center">操作</TableHead>
                            <TableHead className="text-center">開倉日</TableHead>
                            <TableHead className="text-center">到期日</TableHead>
                            <TableHead className="text-center">到期天數</TableHead>
                            <TableHead className="text-center">平倉日</TableHead>
                            <TableHead className="text-center">持有天數</TableHead>
                            <TableHead className="text-center">口數</TableHead>
                            <TableHead className="text-center">底層標的</TableHead>
                            <TableHead className="text-center">多空</TableHead>
                            <TableHead className="text-center">行權價</TableHead>
                            <TableHead className="text-center">備兌資金</TableHead>
                            <TableHead className="text-center">權利金</TableHead>
                            <TableHead className="text-center">已實現損益</TableHead>

                            <TableHead className="text-center">DELTA</TableHead>
                            <TableHead className="text-center">隱含波動</TableHead>
                            <TableHead className="text-center">交易代碼</TableHead>
                            <TableHead className="text-center"></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            <TableRow>
                                <TableCell colSpan={21} className="text-center py-8 text-muted-foreground">
                                    載入中...
                                </TableCell>
                            </TableRow>
                        ) : sortedOptions.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={21} className="text-center py-8 text-muted-foreground">
                                    尚無資料
                                </TableCell>
                            </TableRow>
                        ) : (
                            sortedOptions.map((opt, index) => {
                                const isLastInGroup = index < sortedOptions.length - 1 &&
                                    formatDate(opt.open_date) !== formatDate(sortedOptions[index + 1].open_date);

                                return (
                                    <TableRow
                                        key={opt.id}
                                        className={`hover:bg-muted/50 text-center ${isLastInGroup ? 'border-b-4 border-orange-200' : ''}`}
                                    >
                                        <TableCell>{sortedOptions.length - index}</TableCell>
                                        {params.userId === 'All' && (
                                            <TableCell>
                                                <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                                                    {/* Try to find user display name from users list if possible, else just ID */}
                                                    {(() => {
                                                        const u = users.find(u => u.user_id === opt.user_id || u.id.toString() === opt.user_id);
                                                        return u ? (u.user_id || u.email) : (opt.user_id || '-');
                                                    })()}
                                                </span>
                                            </TableCell>
                                        )}
                                        <TableCell className={(opt.operation || 'Open') === 'Open' ? 'bg-pink-50' : ''}>
                                            {opt.operation === 'Assigned' ? (
                                                <span
                                                    className="text-red-600 bg-red-50 px-2 py-1 rounded-sm cursor-pointer hover:bg-red-100 hover:font-semibold transition-all duration-150"
                                                    // onClick={() => setSelectedOperation(opt.operation || 'Open')}
                                                    // onClick={() => setSelectedOperation(opt.operation || 'Open')}
                                                    title={`點擊過濾 ${opt.operation} 的交易`}
                                                >
                                                    {opt.operation}
                                                </span>
                                            ) : (
                                                <div
                                                    className={`cursor-pointer min-w-[34px] flex justify-center`}
                                                    onClick={() => setSelectedOperation(opt.operation || 'Open')}
                                                    title={`點擊過濾 ${opt.operation || 'Open'} 的交易`}
                                                >
                                                    {opt.operation === 'Expired' ? (
                                                        <Badge className="bg-green-50 text-green-700 hover:bg-green-100 border-none font-normal text-sm px-2 py-0.5">
                                                            Expired
                                                        </Badge>
                                                    ) : (
                                                        opt.operation || 'Open'
                                                    )}
                                                </div>
                                            )}
                                        </TableCell>
                                        <TableCell>{formatDate(opt.open_date)}</TableCell>
                                        <TableCell>{formatDate(opt.to_date)}</TableCell>
                                        <TableCell>{getDaysToExpire(opt)}</TableCell>
                                        <TableCell>
                                            {(opt.operation === 'Open' || !opt.settlement_date) ? (
                                                "-"
                                            ) : (
                                                formatDate(opt.settlement_date)
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            {(opt.operation === 'Open' || !opt.settlement_date) ? '-' : getDaysHeld(opt)}
                                        </TableCell>
                                        <TableCell>{opt.quantity}</TableCell>
                                        <TableCell>
                                            <span
                                                className="cursor-pointer hover:text-primary hover:underline hover:font-semibold transition-all duration-150"
                                                onClick={() => setSelectedUnderlying(opt.underlying)}
                                                title={`點擊過濾 ${opt.underlying} 的交易`}
                                            >
                                                {opt.underlying}
                                            </span>
                                        </TableCell>
                                        <TableCell>
                                            <Badge
                                                variant="outline"
                                                className={`cursor-pointer transition-all duration-150 ${opt.type === 'CALL'
                                                    ? 'text-green-600 border-green-200 bg-green-50 hover:bg-green-100 hover:border-green-300 hover:font-semibold'
                                                    : 'text-red-600 border-red-200 bg-red-50 hover:bg-red-100 hover:border-red-300 hover:font-semibold'
                                                    }`}
                                                onClick={() => setSelectedType(opt.type)}
                                                title={`點擊過濾 ${opt.type} 的交易`}
                                            >
                                                {opt.type}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>{opt.strike_price}</TableCell>
                                        <TableCell>{opt.collateral?.toLocaleString() || '-'}</TableCell>
                                        <TableCell>{opt.premium?.toLocaleString() || '-'}</TableCell>
                                        <TableCell className={opt.final_profit !== null && opt.final_profit < 0 ? 'bg-pink-50' : ''}>
                                            {opt.final_profit ? opt.final_profit.toLocaleString('en-US') : '-'}
                                        </TableCell>

                                        <TableCell>{opt.delta?.toFixed(3) || '-'}</TableCell>
                                        <TableCell>{opt.iv || '-'}</TableCell>
                                        <TableCell className="text-center font-mono text-sm">
                                            {opt.code || '-'}
                                        </TableCell>
                                        <TableCell>
                                            {/* Only non-customer roles can edit/delete */}
                                            {currentUserRole && currentUserRole !== 'customer' && (
                                                <div className="flex justify-center gap-1">
                                                    <TooltipProvider>
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    onClick={() => handleEdit(opt)}
                                                                    className="h-8 w-8 text-muted-foreground hover:text-primary"
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
                                                                    onClick={() => handleDelete(opt.id)}
                                                                    className="h-8 w-8 text-muted-foreground hover:text-red-600"
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
                                            )}
                                        </TableCell>
                                    </TableRow>
                                );
                            })
                        )}
                    </TableBody>
                </Table>
            </div>

            <NewOptionDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                onSuccess={fetchOptions}

                userId={params.userId} // Keep for backward compat if needed, or remove if dialog updated
                ownerId={ownerId} // Pass ownerId
            />

            <EditOptionDialog
                open={editDialogOpen}
                onOpenChange={(open) => {
                    setEditDialogOpen(open);
                    if (!open) setOptionToEdit(null);
                }}
                onSuccess={fetchOptions}
                optionToEdit={optionToEdit}
            />

            <AlertDialog open={!!optionToDelete} onOpenChange={(open) => !open && setOptionToDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>確定要刪除嗎？</AlertDialogTitle>
                        <AlertDialogDescription>
                            此動作無法復原。這將永久刪除此交易紀錄。
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

            <AlertDialog open={isDeleteAllOpen} onOpenChange={setIsDeleteAllOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>確定要刪除全部資料嗎？</AlertDialogTitle>
                        <AlertDialogDescription>
                            此動作無法復原。這將會永久刪除 {selectedYear === 'All' ? '所有年份' : `${selectedYear}年`} {params.userId} 的所有期權交易資料。
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDeleteAll}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            確認刪除
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
