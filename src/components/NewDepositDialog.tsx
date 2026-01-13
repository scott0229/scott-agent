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
    users: User[];
}

export function NewDepositDialog({ open, onOpenChange, onSuccess, users }: NewDepositDialogProps) {
    const [depositDate, setDepositDate] = useState('');
    const [userId, setUserId] = useState('');
    const [amount, setAmount] = useState('');
    const [note, setNote] = useState('');
    const [depositType, setDepositType] = useState('cash');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Set today's date when dialog opens
    useEffect(() => {
        if (open) {
            const today = new Date();
            const dateStr = today.toISOString().split('T')[0];
            setDepositDate(dateStr);
        }
    }, [open]);

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
                    <DialogTitle>新增入金記錄</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit}>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor="depositDate">入金日期 *</Label>
                            <Input
                                id="depositDate"
                                type="date"
                                value={depositDate}
                                onChange={(e) => setDepositDate(e.target.value)}
                                required
                            />
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="user">用戶 *</Label>
                            <Select value={userId} onValueChange={setUserId} required>
                                <SelectTrigger>
                                    <SelectValue placeholder="選擇用戶" />
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

                        <div className="grid gap-2">
                            <Label htmlFor="amount">金額 *</Label>
                            <Input
                                id="amount"
                                type="text"
                                placeholder="0"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                required
                            />
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="depositType">類型 *</Label>
                            <Select value={depositType} onValueChange={setDepositType} required>
                                <SelectTrigger>
                                    <SelectValue placeholder="選擇類型" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="cash">現金</SelectItem>
                                    <SelectItem value="stock">股票</SelectItem>
                                    <SelectItem value="both">股票+現金</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="note">備註</Label>
                            <Textarea
                                id="note"
                                placeholder="選填"
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                rows={3}
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
