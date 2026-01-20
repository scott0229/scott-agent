'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface PerformanceRecord {
    id: number;
    date: number;
    net_equity: number;
    cash_balance?: number | null;
}

interface EditNetEquityDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: () => void;
    recordToEdit: PerformanceRecord | null;
}

// Format number with thousand separators
// Format number with thousand separators
const formatNumber = (value: string): string => {
    // Handle empty input
    if (!value) return '';

    // Check if it's negative
    const isNegative = value.startsWith('-');

    // Remove all non-digit and non-decimal characters
    const cleanValue = value.replace(/[^\d.]/g, '');

    // Handle case where user just typed "-"
    if (isNegative && !cleanValue) return '-';

    // Handle empty result after cleaning
    if (!cleanValue) return '';

    // Prevent multiple decimal points - keep only the first one
    const parts = cleanValue.split('.');
    const integerPart = parts[0];
    const decimalPart = parts.length > 1 ? parts[1] : undefined;

    // Don't format if empty
    let formatted = integerPart;
    if (integerPart) {
        // Add thousand separators to integer part
        formatted = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    // Recombine with decimal part if it exists
    const result = decimalPart !== undefined ? `${formatted}.${decimalPart}` : formatted;

    return isNegative ? `-${result}` : result;
};

// Parse formatted number back to float
const parseNumber = (value: string): number => {
    return parseFloat(value.replace(/,/g, '')) || 0;
};

const formatDateForInput = (timestamp: number | null) => {
    if (!timestamp) return '';
    const d = new Date(timestamp * 1000);
    return d.toISOString().split('T')[0];
};

export function EditNetEquityDialog({ open, onOpenChange, onSuccess, recordToEdit }: EditNetEquityDialogProps) {
    const [formData, setFormData] = useState({
        date: '',
        net_equity: '',
        cash_balance: '',
        deposit: ''
    });
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const isComposing = useRef(false);

    useEffect(() => {
        if (recordToEdit) {
            setFormData({
                date: formatDateForInput(recordToEdit.date),
                net_equity: formatNumber(recordToEdit.net_equity.toString()),
                cash_balance: (recordToEdit.cash_balance !== null && recordToEdit.cash_balance !== undefined) ? formatNumber(recordToEdit.cash_balance.toString()) : '',
                deposit: (recordToEdit as any).deposit !== undefined && (recordToEdit as any).deposit !== null ? formatNumber((recordToEdit as any).deposit.toString()) : '0'
            });
        }
    }, [recordToEdit]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!recordToEdit) return;

        setIsLoading(true);
        setError(null);

        try {
            const payload = {
                id: recordToEdit.id,
                date: Math.floor(new Date(formData.date).getTime() / 1000),
                net_equity: parseNumber(formData.net_equity),
                cash_balance: formData.cash_balance ? parseNumber(formData.cash_balance) : null,
                deposit: formData.deposit ? parseNumber(formData.deposit) : 0
            };

            const res = await fetch('/api/net-equity', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (res.ok) {
                onSuccess();
                onOpenChange(false);
            } else {
                const data = await res.json();
                setError(data.error || '更新失敗');
            }
        } catch (error) {
            console.error('Failed to update net equity', error);
            setError('發生錯誤，請稍後再試');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>編輯淨值記錄</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="grid gap-4">
                    {error && (
                        <div className="bg-red-50 text-red-600 px-4 py-2 rounded-md text-sm border border-red-200">
                            {error}
                        </div>
                    )}

                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="date" className="text-right">日期</Label>
                        <Input
                            id="date"
                            type="date"
                            className="col-span-3"
                            value={formData.date}
                            onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                            required
                        />
                    </div>

                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="net_equity" className="text-right">帳戶淨值</Label>
                        <Input
                            id="net_equity"
                            type="text"
                            className="col-span-3"
                            value={formData.net_equity}
                            onCompositionStart={() => isComposing.current = true}
                            onCompositionEnd={(e) => {
                                isComposing.current = false;
                                setFormData({ ...formData, net_equity: formatNumber(e.currentTarget.value) });
                            }}
                            onChange={(e) => {
                                if (isComposing.current) {
                                    setFormData({ ...formData, net_equity: e.target.value });
                                    return;
                                }
                                const formatted = formatNumber(e.target.value);
                                setFormData({ ...formData, net_equity: formatted });
                            }}
                            required
                        />
                    </div>

                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="cash_balance" className="text-right">現金水位</Label>
                        <Input
                            id="cash_balance"
                            type="text"
                            className="col-span-3"
                            value={formData.cash_balance}
                            onCompositionStart={() => isComposing.current = true}
                            onCompositionEnd={(e) => {
                                isComposing.current = false;
                                setFormData({ ...formData, cash_balance: formatNumber(e.currentTarget.value) });
                            }}
                            onChange={(e) => {
                                if (isComposing.current) {
                                    setFormData({ ...formData, cash_balance: e.target.value });
                                    return;
                                }
                                const formatted = formatNumber(e.target.value);
                                setFormData({ ...formData, cash_balance: formatted });
                            }}
                        />
                    </div>

                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="deposit" className="text-right">匯款記錄</Label>
                        <Input
                            id="deposit"
                            type="text"
                            className="col-span-3"
                            value={formData.deposit}
                            onCompositionStart={() => isComposing.current = true}
                            onCompositionEnd={(e) => {
                                isComposing.current = false;
                                setFormData({ ...formData, deposit: formatNumber(e.currentTarget.value) });
                            }}
                            onChange={(e) => {
                                if (isComposing.current) {
                                    setFormData({ ...formData, deposit: e.target.value });
                                    return;
                                }
                                const formatted = formatNumber(e.target.value);
                                setFormData({ ...formData, deposit: formatted });
                            }}
                        />
                    </div>

                    <div className="flex justify-end gap-3 mt-4">
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            取消
                        </Button>
                        <Button type="submit" disabled={isLoading}>
                            {isLoading ? '儲存中...' : '儲存'}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}
