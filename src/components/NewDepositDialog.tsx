'use client';

import { useState, useEffect } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface User {
    id: number;
    user_id: string | null;
    email: string;
}

interface NewDepositDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: () => void;
}

export function NewDepositDialog({ open, onOpenChange, onSuccess }: NewDepositDialogProps) {
    const [depositDate, setDepositDate] = useState('');
    const [userId, setUserId] = useState('');
    const [amount, setAmount] = useState('');
    const [note, setNote] = useState('');
    const [depositType, setDepositType] = useState('cash');
    const [transactionType, setTransactionType] = useState('deposit');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [users, setUsers] = useState<User[]>([]);
    const [isLoadingUsers, setIsLoadingUsers] = useState(false);

    // Set today's date when dialog opens
    useEffect(() => {
        if (open) {
            const today = new Date();
            const dateStr = today.toISOString().split('T')[0];
            setDepositDate(dateStr);
        }
    }, [open]);

    // Fetch users when date changes
    useEffect(() => {
        if (!depositDate) return;

        const year = new Date(depositDate).getFullYear();

        const fetchUsers = async () => {
            setIsLoadingUsers(true);
            try {
                const res = await fetch(`/api/users?mode=selection&roles=customer&year=${year}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.users) {
                        setUsers(data.users);
                    }
                }
            } catch (error) {
                console.error('Failed to fetch users:', error);
            } finally {
                setIsLoadingUsers(false);
            }
        };

        fetchUsers();
    }, [depositDate]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!depositDate || !userId || !amount) return;

        setIsSubmitting(true);

        try {
            // Convert date string to Unix timestamp
            const timestamp = Math.floor(new Date(depositDate).getTime() / 1000);

            const res = await fetch('/api/deposits', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    deposit_date: timestamp,
                    user_id: parseInt(userId),
                    amount: parseFloat(amount),
                    note: note || null,
                    deposit_type: depositType,
                    transaction_type: transactionType,
                }),
            });

            if (res.ok) {
                onSuccess();
                onOpenChange(false);
                // Reset form
                setDepositDate('');
                setUserId('');
                setAmount('');
                setNote('');
                setDepositType('cash');
                setTransactionType('deposit');
                setUsers([]);
            }
        } catch (error) {
            console.error('Failed to create deposit:', error);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>新增匯款記錄</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit}>
                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="depositDate" className="text-right">
                                入金日期
                            </Label>
                            <Input
                                id="depositDate"
                                type="date"
                                value={depositDate}
                                onChange={(e) => setDepositDate(e.target.value)}
                                required
                                className="col-span-3"
                            />
                        </div>

                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="user" className="text-right">
                                用戶
                            </Label>
                            <Select value={userId} onValueChange={setUserId} required>
                                <SelectTrigger className="col-span-3">
                                    <SelectValue placeholder={isLoadingUsers ? "載入中..." : "選擇用戶"} />
                                </SelectTrigger>
                                <SelectContent>
                                    {users.map((user) => (
                                        <SelectItem key={user.id} value={user.id.toString()}>
                                            {user.user_id || user.email}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="transactionType" className="text-right">
                                資金流動
                            </Label>
                            <Select value={transactionType} onValueChange={setTransactionType} required>
                                <SelectTrigger className="col-span-3">
                                    <SelectValue placeholder="選擇資金流動" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="deposit">入金</SelectItem>
                                    <SelectItem value="withdrawal">出金</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="depositType" className="text-right">
                                類型
                            </Label>
                            <Select value={depositType} onValueChange={setDepositType} required>
                                <SelectTrigger className="col-span-3">
                                    <SelectValue placeholder="選擇類型" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="cash">現金</SelectItem>
                                    <SelectItem value="stock">股票</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="amount" className="text-right">
                                等價金額
                            </Label>
                            <Input
                                id="amount"
                                type="text"
                                placeholder="0"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                required
                                className="col-span-3"
                            />
                        </div>

                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="note" className="text-right">
                                備註
                            </Label>
                            <Textarea
                                id="note"
                                placeholder="選填"
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                rows={3}
                                className="col-span-3"
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                            disabled={isSubmitting}
                        >
                            取消
                        </Button>
                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting ? '新增中...' : '新增'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
