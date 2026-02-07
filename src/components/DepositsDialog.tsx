'use client';

import { useState, useEffect } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    TableFooter,
} from "@/components/ui/table";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Wallet, FilterX } from 'lucide-react';
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

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
}

interface User {
    id: number;
    user_id: string | null;
    email: string;
}

interface DepositsDialogProps {
    initialYear: string;
}

export function DepositsDialog({ initialYear }: DepositsDialogProps) {
    const [open, setOpen] = useState(false);
    const [deposits, setDeposits] = useState<Deposit[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    // Filters
    const [selectedYear, setSelectedYear] = useState(initialYear);
    const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
    const [selectedTransactionType, setSelectedTransactionType] = useState('All');

    // Permissions (simplified for now, assuming if you can see the button you can filters)
    // We'll fetch current user to confirm admin status for User filter
    const [isAdmin, setIsAdmin] = useState(false);

    const { toast } = useToast();

    // Fetch user role on mount
    useEffect(() => {
        const checkAuth = async () => {
            try {
                const res = await fetch('/api/auth/me');
                if (res.ok) {
                    const data = await res.json();
                    if (data.user.role === 'admin' || data.user.role === 'manager') {
                        setIsAdmin(true);
                        fetchUsers(); // Only fetch users list if admin
                    }
                }
            } catch (e) {
                console.error(e);
            }
        };
        checkAuth();
    }, []);

    // Sync initialYear if it changes and dialog is closed? 
    // Or just set it when dialog opens?
    // Let's just track it.
    useEffect(() => {
        if (!open) {
            setSelectedYear(initialYear); // Reset year to context when closed/re-opened
        }
    }, [open, initialYear]);


    const fetchUsers = async () => {
        try {
            const res = await fetch('/api/users');
            if (res.ok) {
                const data = await res.json();
                setUsers(data.users);
            }
        } catch (error) {
            console.error('Failed to fetch users:', error);
        }
    };

    const fetchRecords = async () => {
        setIsLoading(true);
        try {
            const params = new URLSearchParams();
            if (selectedYear !== 'All') params.append('year', selectedYear);
            if (selectedUserIds.length > 0 && !(selectedUserIds.length === 1 && selectedUserIds[0] === 'All')) {
                params.append('userId', selectedUserIds.join(','));
            }
            if (selectedTransactionType !== 'All') params.append('transaction_type', selectedTransactionType);

            const res = await fetch(`/api/deposits?${params.toString()}`);
            if (!res.ok) throw new Error('Failed to fetch records');
            const data = await res.json();
            setDeposits(data.deposits);
        } catch (error) {
            console.error('Failed to fetch records:', error);
            toast({
                variant: "destructive",
                title: "錯誤",
                description: "無法載入記錄",
            });
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (open) {
            fetchRecords();
        }
    }, [open, selectedYear, selectedUserIds, selectedTransactionType]);

    const formatMoney = (amount: number) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).format(amount);
    };

    const formatDate = (timestamp: number) => {
        return new Date(timestamp * 1000).toLocaleDateString('zh-TW', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        });
    };

    const totalAmount = deposits.reduce((sum, deposit) => {
        if (deposit.transaction_type === 'withdrawal') {
            return sum - deposit.amount;
        }
        return sum + deposit.amount;
    }, 0);

    const clearFilters = () => {
        // Year comes from parent context, do not reset it
        setSelectedTransactionType('All');
        setSelectedUserIds([]);
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" className="hover:bg-accent hover:text-accent-foreground">
                    <Wallet className="h-4 w-4 mr-2" />
                    存款和取款
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-2xl w-full h-[60vh] flex flex-col">
                <DialogHeader>
                    <div className="flex items-center justify-between mr-8">
                        <DialogTitle className="text-xl">存款和取款</DialogTitle>
                        <div className="flex items-center gap-2">
                            {/* Transaction Type Filter */}
                            <Select value={selectedTransactionType} onValueChange={setSelectedTransactionType}>
                                <SelectTrigger className="w-[110px]">
                                    <SelectValue placeholder="資金流向" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="All">全部流向</SelectItem>
                                    <SelectItem value="deposit">入金</SelectItem>
                                    <SelectItem value="withdrawal">出金</SelectItem>
                                </SelectContent>
                            </Select>

                            {/* User Filter */}
                            {isAdmin && (
                                <Select
                                    value={selectedUserIds.length === 0 ? "All" : (selectedUserIds.length === 1 ? selectedUserIds[0] : "Multi")}
                                    onValueChange={(val) => {
                                        if (val === "All") setSelectedUserIds([]);
                                        else if (val !== "Multi") setSelectedUserIds([val]);
                                    }}
                                >
                                    <SelectTrigger className="w-[150px]">
                                        <SelectValue placeholder="全部用戶">
                                            {selectedUserIds.length === 0 ? "全部用戶" :
                                                selectedUserIds.length === 1 ? users.find(u => u.id.toString() === selectedUserIds[0])?.user_id || "未知用戶" :
                                                    `已選 ${selectedUserIds.length} 位`}
                                        </SelectValue>
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="All">全部用戶</SelectItem>
                                        {users.filter(user => user.user_id?.toLowerCase() !== 'admin').map((user) => (
                                            <SelectItem key={user.id} value={user.id.toString()}>
                                                {user.user_id || user.email}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}


                        </div>
                    </div>
                </DialogHeader>

                <div className="flex-1 flex flex-col border rounded-md min-h-0 bg-[#F2efe9] overflow-hidden text-sm">
                    {/* Header */}
                    <div className="grid grid-cols-[50px_120px_1.5fr_100px_1fr] border-b bg-[#ebdccb] h-10 items-center px-4 font-bold text-[#5c4936]">
                        <div className="text-center">#</div>
                        <div className="text-center">日期</div>
                        <div className="text-center">用戶</div>
                        <div className="text-center">資金流動</div>
                        <div className="text-center">金額</div>
                    </div>

                    {/* Scrollable Body */}
                    <div className="flex-1 overflow-y-auto bg-white px-4">
                        {isLoading ? (
                            <div className="flex h-24 items-center justify-center">
                                載入中...
                            </div>
                        ) : deposits.length === 0 ? (
                            <div className="flex h-24 items-center justify-center text-muted-foreground">
                                尚無記錄
                            </div>
                        ) : (
                            deposits.map((deposit, index) => (
                                <div
                                    key={deposit.id}
                                    className="grid grid-cols-[50px_120px_1.5fr_100px_1fr] border-b hover:bg-muted/50 h-10 items-center"
                                >
                                    <div className="text-center font-mono text-muted-foreground">{deposits.length - index}</div>
                                    <div className="text-center">{formatDate(deposit.deposit_date)}</div>
                                    <div className="text-center truncate px-2" title={deposit.depositor_user_id || deposit.depositor_email}>
                                        {deposit.depositor_user_id || deposit.depositor_email}
                                    </div>
                                    <div className="text-center">
                                        <Badge
                                            className={cn(
                                                "font-normal",
                                                deposit.transaction_type === 'deposit'
                                                    ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100"
                                                    : "bg-red-100 text-red-700 hover:bg-red-100"
                                            )}
                                        >
                                            {deposit.transaction_type === 'deposit' ? '入金' : '出金'}
                                        </Badge>
                                    </div>
                                    <div className="text-center font-mono">{formatMoney(deposit.amount)}</div>
                                </div>
                            ))
                        )}
                    </div>

                    {/* Sticky Footer */}
                    {deposits.length > 0 && (
                        <div className="border-t bg-[#ebdccb] h-10 flex items-center justify-end px-4 font-bold text-[#5c4936] z-20 relative shrink-0">
                            總計 {formatMoney(totalAmount)}
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
