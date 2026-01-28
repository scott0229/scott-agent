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

interface EditInitialCostDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: () => void;
    userDbId: number | null;
    initialValues: {
        initialCost: number;
        initialCash: number;
        initialManagementFee: number;
        initialDeposit: number;
        initialInterest: number;
    };
}

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

export function EditInitialCostDialog({ open, onOpenChange, onSuccess, userDbId, initialValues }: EditInitialCostDialogProps) {
    const [formData, setFormData] = useState({
        initialCost: '',
        initialCash: '',
        initialManagementFee: '',
        initialDeposit: '',
        initialInterest: ''
    });
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const isComposing = useRef(false);

    useEffect(() => {
        if (open) {
            setFormData({
                initialCost: formatNumber(initialValues.initialCost.toString()),
                initialCash: formatNumber(initialValues.initialCash.toString()),
                initialManagementFee: formatNumber(initialValues.initialManagementFee.toString()),
                initialDeposit: formatNumber(initialValues.initialDeposit.toString()),
                initialInterest: formatNumber(initialValues.initialInterest.toString())
            });
        }
    }, [open, initialValues]);

    const handleChange = (field: keyof typeof formData, value: string) => {
        if (isComposing.current) {
            setFormData(prev => ({ ...prev, [field]: value }));
            return;
        }
        setFormData(prev => ({ ...prev, [field]: formatNumber(value) }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!userDbId) {
            setError("無法找到使用者 ID，請重新整理頁面");
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const payload = {
                id: userDbId,
                initialCost: parseNumber(formData.initialCost),
                initialCash: parseNumber(formData.initialCash),
                initialManagementFee: parseNumber(formData.initialManagementFee),
                initialDeposit: parseNumber(formData.initialDeposit),
                initialInterest: parseNumber(formData.initialInterest)
            };

            const res = await fetch('/api/users', {
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
            console.error('Failed to update initial values', error);
            setError('發生錯誤，請稍後再試');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>編輯年初數據</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="grid gap-4">
                    {error && (
                        <div className="bg-red-50 text-red-600 px-4 py-2 rounded-md text-sm border border-red-200">
                            {error}
                        </div>
                    )}

                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="initial_cost" className="text-right">帳戶淨值</Label>
                        <Input
                            id="initial_cost"
                            type="text"
                            className="col-span-3"
                            value={formData.initialCost}
                            onCompositionStart={() => isComposing.current = true}
                            onCompositionEnd={(e) => {
                                isComposing.current = false;
                                handleChange('initialCost', e.currentTarget.value);
                            }}
                            onChange={(e) => handleChange('initialCost', e.target.value)}
                        />
                    </div>

                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="initial_cash" className="text-right">帳戶現金</Label>
                        <Input
                            id="initial_cash"
                            type="text"
                            className="col-span-3"
                            value={formData.initialCash}
                            onCompositionStart={() => isComposing.current = true}
                            onCompositionEnd={(e) => {
                                isComposing.current = false;
                                handleChange('initialCash', e.currentTarget.value);
                            }}
                            onChange={(e) => handleChange('initialCash', e.target.value)}
                        />
                    </div>

                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="initial_management_fee" className="text-right">管理費支出</Label>
                        <Input
                            id="initial_management_fee"
                            type="text"
                            className="col-span-3"
                            value={formData.initialManagementFee}
                            onCompositionStart={() => isComposing.current = true}
                            onCompositionEnd={(e) => {
                                isComposing.current = false;
                                handleChange('initialManagementFee', e.currentTarget.value);
                            }}
                            onChange={(e) => handleChange('initialManagementFee', e.target.value)}
                        />
                    </div>

                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="initial_deposit" className="text-right">轉帳記錄</Label>
                        <Input
                            id="initial_deposit"
                            type="text"
                            className="col-span-3"
                            value={formData.initialDeposit}
                            onCompositionStart={() => isComposing.current = true}
                            onCompositionEnd={(e) => {
                                isComposing.current = false;
                                handleChange('initialDeposit', e.currentTarget.value);
                            }}
                            onChange={(e) => handleChange('initialDeposit', e.target.value)}
                        />
                    </div>

                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="initial_interest" className="text-right">利息收支</Label>
                        <Input
                            id="initial_interest"
                            type="text"
                            className="col-span-3"
                            value={formData.initialInterest}
                            onCompositionStart={() => isComposing.current = true}
                            onCompositionEnd={(e) => {
                                isComposing.current = false;
                                handleChange('initialInterest', e.currentTarget.value);
                            }}
                            onChange={(e) => handleChange('initialInterest', e.target.value)}
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
