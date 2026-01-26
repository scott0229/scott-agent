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
    const [selectedMonth, setSelectedMonth] = useState<string>('All');
    const [selectedUnderlying, setSelectedUnderlying] = useState<string>('All');
    const [selectedType, setSelectedType] = useState<string>('All');
    const [selectedStatus, setSelectedStatus] = useState<string>('All');
    const [selectedOperation, setSelectedOperation] = useState<string>('All');

    const [ownerId, setOwnerId] = useState<number | null>(null);
    const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);

    const { toast } = useToast();
    const router = useRouter();

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
                // Fetch all users for selection
                const res = await fetch(`/api/users?mode=selection`, {
                    credentials: 'include'
                });
                const data = await res.json();
                if (data.users && data.users.length > 0) {
                    // Filter out admin user
                    const filteredUsers = data.users.filter((u: any) => u.user_id !== 'admin' && u.email !== 'admin@example.com' && u.role !== 'admin');
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
            const res = await fetch(`/api/options?userId=${params.userId}&year=${year}`, { cache: 'no-store' });
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
    }, [params.userId, selectedYear]);

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
    const operations = Array.from(new Set(options.map(opt => opt.operation || '無'))).sort();

    const filteredOptions = options.filter(opt => {
        const date = new Date(opt.open_date * 1000);
        // Year filter is handled by API query based on selectedYear
        const monthMatch = selectedMonth === 'All' || (date.getMonth() + 1).toString() === selectedMonth;
        const underlyingMatch = selectedUnderlying === 'All' || opt.underlying === selectedUnderlying;
        const typeMatch = selectedType === 'All' || opt.type === selectedType;
        const statusMatch = selectedStatus === 'All' || opt.status === selectedStatus;
        const operationMatch = selectedOperation === 'All' || (opt.operation || '無') === selectedOperation;
        return monthMatch && underlyingMatch && typeMatch && statusMatch && operationMatch;
    }).sort((a, b) => b.open_date - a.open_date);

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
                                onValueChange={(newId) => router.push(`/options/${newId}`)}
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
                        <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                            <SelectTrigger className="w-[100px] focus:ring-0 focus:ring-offset-0"><SelectValue placeholder="狀態" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="All">全部狀態</SelectItem>
                                {statuses.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
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
                            <TableHead className="text-center">狀態</TableHead>
                            <TableHead className="text-center">操作</TableHead>
                            <TableHead className="text-center">開倉日</TableHead>
                            <TableHead className="text-center">到期日</TableHead>
                            <TableHead className="text-center">到期天數</TableHead>
                            <TableHead className="text-center">結算日</TableHead>
                            <TableHead className="text-center">持有天數</TableHead>
                            <TableHead className="text-center">口數</TableHead>
                            <TableHead className="text-center">底層標的</TableHead>
                            <TableHead className="text-center">多空</TableHead>
                            <TableHead className="text-center">行權價</TableHead>
                            <TableHead className="text-center">備兌資金</TableHead>
                            <TableHead className="text-center">權利金</TableHead>
                            <TableHead className="text-center">最終損益</TableHead>
                            <TableHead className="text-center">損益%</TableHead>
                            <TableHead className="text-center">DELTA</TableHead>
                            <TableHead className="text-center">隱含波動</TableHead>
                            <TableHead className="text-center">資金效率</TableHead>
                            <TableHead className="text-center"></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            <TableRow>
                                <TableCell colSpan={20} className="text-center py-8 text-muted-foreground">
                                    載入中...
                                </TableCell>
                            </TableRow>
                        ) : filteredOptions.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={20} className="text-center py-8 text-muted-foreground">
                                    尚無資料
                                </TableCell>
                            </TableRow>
                        ) : (
                            filteredOptions.map((opt, index) => (
                                <TableRow key={opt.id} className="hover:bg-muted/50 text-center">
                                    <TableCell>{filteredOptions.length - index}</TableCell>
                                    <TableCell>
                                        <Badge variant={opt.status === '已關' ? 'secondary' : 'outline'} className={opt.status === '未平倉' ? 'text-blue-600 border-blue-200 bg-blue-50' : ''}>
                                            {opt.status}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>
                                        {opt.operation === '中途被行權' ? (
                                            <span className="text-red-600 bg-red-50 px-2 py-1 rounded-sm">
                                                {opt.operation}
                                            </span>
                                        ) : (
                                            opt.operation || '無'
                                        )}
                                    </TableCell>
                                    <TableCell>{formatDate(opt.open_date)}</TableCell>
                                    <TableCell>{formatDate(opt.to_date)}</TableCell>
                                    <TableCell>{getDaysToExpire(opt)}</TableCell>
                                    <TableCell>{formatDate(opt.settlement_date)}</TableCell>
                                    <TableCell>{getDaysHeld(opt)}</TableCell>
                                    <TableCell>{opt.quantity}</TableCell>
                                    <TableCell>{opt.underlying}</TableCell>
                                    <TableCell>
                                        <Badge variant="outline" className={opt.type === 'CALL' ? 'text-green-600 border-green-200 bg-green-50' : 'text-red-600 border-red-200 bg-red-50'}>
                                            {opt.type}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>{opt.strike_price}</TableCell>
                                    <TableCell>{opt.collateral?.toLocaleString() || '-'}</TableCell>
                                    <TableCell>{opt.premium?.toLocaleString() || '-'}</TableCell>
                                    <TableCell>
                                        {opt.status === '未平倉' ? (
                                            <Badge variant="outline" className="text-red-600 border-red-200 bg-red-50">
                                                {opt.final_profit?.toLocaleString() || '-'}
                                            </Badge>
                                        ) : (
                                            <span className={opt.final_profit && opt.final_profit > 0 ? 'text-green-600' : opt.final_profit && opt.final_profit < 0 ? 'text-red-600' : ''}>
                                                {opt.final_profit?.toLocaleString() || '-'}
                                            </span>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        {(() => {
                                            if (opt.final_profit !== null && opt.final_profit !== undefined && opt.premium) {
                                                return `${((opt.final_profit / opt.premium) * 100).toFixed(1)}%`;
                                            }
                                            return opt.profit_percent ? `${(opt.profit_percent * 100).toFixed(1)}%` : '-';
                                        })()}
                                    </TableCell>
                                    <TableCell>{opt.delta?.toFixed(3) || '-'}</TableCell>
                                    <TableCell>{opt.iv || '-'}</TableCell>
                                    <TableCell>
                                        {(() => {
                                            const daysHeld = typeof getDaysHeld(opt) === 'number' ? getDaysHeld(opt) : null;
                                            if (
                                                opt.final_profit !== null &&
                                                opt.final_profit !== undefined &&
                                                daysHeld &&
                                                daysHeld > 0 &&
                                                opt.collateral &&
                                                opt.collateral > 0
                                            ) {
                                                const efficiency = opt.final_profit / (Number(daysHeld) * opt.collateral);
                                                return `${(efficiency * 100).toFixed(3)}%`;
                                            }
                                            return opt.capital_efficiency ? `${(opt.capital_efficiency * 100).toFixed(3)}%` : '-';
                                        })()}
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
                            ))
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
