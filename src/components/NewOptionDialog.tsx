'use client';

import { useState } from 'react';
import { useYearFilter } from '@/contexts/YearFilterContext';
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

interface NewOptionDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: () => void;
    userId: string; // Add userId prop
    ownerId?: number | null; // Add ownerId prop
}

const getNextWorkday = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    while (d.getDay() === 0 || d.getDay() === 6) {
        d.setDate(d.getDate() + 1);
    }
    return d.toISOString().split('T')[0];
};

export function NewOptionDialog({ open, onOpenChange, onSuccess, userId, ownerId }: NewOptionDialogProps) {
    const { selectedYear } = useYearFilter();
    const [formData, setFormData] = useState({
        status: '未平倉',
        operation: '無',
        open_date: new Date().toISOString().split('T')[0],

        to_date: getNextWorkday(),
        settlement_date: getNextWorkday(),
        quantity: '',
        underlying: '',
        type: 'CALL',
        strike_price: '',
        premium: '',
        collateral: '',
        iv: '',
        delta: ''
    });
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isSettlementDateDirty, setIsSettlementDateDirty] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (parseFloat(formData.quantity) === 0) {
            setError('口數不能為 0');
            return;
        }

        // Validate year consistency
        const openDateYear = new Date(formData.open_date).getFullYear();
        const expectedYear = selectedYear === 'All' ? new Date().getFullYear() : parseInt(selectedYear);

        if (openDateYear !== expectedYear) {
            setError(`開倉日期的年份 (${openDateYear}) 與當前選擇的年份 (${expectedYear}) 不一致，請修正後再儲存。`);
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            // Calculate derived fields if needed, or send raw
            const payload = {
                ...formData,
                open_date: Math.floor(new Date(formData.open_date).getTime() / 1000),

                to_date: formData.to_date ? Math.floor(new Date(formData.to_date).getTime() / 1000) : null,
                settlement_date: formData.settlement_date ? Math.floor(new Date(formData.settlement_date).getTime() / 1000) : null,
                quantity: parseFloat(formData.quantity),
                strike_price: parseFloat(formData.strike_price),
                premium: formData.premium ? parseFloat(formData.premium) : 0,
                collateral: Math.abs(parseFloat(formData.quantity)) * parseFloat(formData.strike_price) * 100,
                iv: formData.iv ? parseFloat(formData.iv) : null,
                delta: formData.delta ? parseFloat(formData.delta) : null,

                userId: userId, // Include userId in payload
                ownerId: ownerId, // Include ownerId in payload
                year: selectedYear === 'All' ? new Date().getFullYear() : parseInt(selectedYear) // Include year
            };

            const res = await fetch('/api/options', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (res.ok) {
                onSuccess();
                onOpenChange(false);
                // Reset form
                setFormData({
                    status: '未平倉',
                    operation: '無',
                    open_date: new Date().toISOString().split('T')[0],

                    to_date: getNextWorkday(),
                    settlement_date: getNextWorkday(),
                    quantity: '',
                    underlying: '',
                    type: 'CALL',
                    strike_price: '',
                    premium: '',
                    collateral: '',
                    iv: '',
                    delta: ''
                });
                setIsSettlementDateDirty(false);
            } else {
                const data = await res.json();
                setError(data.error || '新增失敗');
            }
        } catch (error) {
            console.error('Failed to create option', error);
            setError('發生錯誤，請稍後再試');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>新增交易</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="grid gap-4 py-4">
                    {error && (
                        <div className="bg-red-50 text-red-600 px-4 py-2 rounded-md text-sm border border-red-200">
                            {error}
                        </div>
                    )}
                    <div className="grid grid-cols-2 gap-4">




                        <div className="grid gap-2">
                            <Label htmlFor="open_date">開倉日</Label>
                            <Input
                                id="open_date"
                                type="date"
                                value={formData.open_date}
                                onChange={(e) => setFormData({ ...formData, open_date: e.target.value })}
                                required
                            />
                        </div>



                        <div className="grid gap-2">
                            <Label htmlFor="to_date">到期日</Label>
                            <Input
                                id="to_date"
                                type="date"
                                value={formData.to_date}
                                onChange={(e) => {
                                    const newVal = e.target.value;
                                    setFormData(prev => ({
                                        ...prev,
                                        to_date: newVal,
                                        settlement_date: isSettlementDateDirty ? prev.settlement_date : newVal
                                    }));
                                }}
                                required
                            />
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="settlement_date">結算日</Label>
                            <Input
                                id="settlement_date"
                                type="date"
                                value={formData.settlement_date}
                                onChange={(e) => {
                                    setFormData({ ...formData, settlement_date: e.target.value });
                                    setIsSettlementDateDirty(true);
                                }}
                            />
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="underlying">底層標的</Label>
                            <Input
                                id="underlying"
                                value={formData.underlying}
                                onChange={(e) => setFormData({ ...formData, underlying: e.target.value.toUpperCase() })}
                                required
                            />
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="type">多空</Label>
                            <Select
                                value={formData.type}
                                onValueChange={(value) => setFormData({ ...formData, type: value })}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="選擇類型" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="CALL">CALL</SelectItem>
                                    <SelectItem value="PUT">PUT</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="quantity">口數 (負數為賣出)</Label>
                            <Input
                                id="quantity"
                                type="number"
                                step="1"
                                value={formData.quantity}
                                onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                                required
                            />
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="strike_price">行權價</Label>
                            <Input
                                id="strike_price"
                                type="number"
                                step="0.01"
                                value={formData.strike_price}
                                onChange={(e) => setFormData({ ...formData, strike_price: e.target.value })}
                                required
                            />
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="premium">權利金</Label>
                            <Input
                                id="premium"
                                type="number"
                                step="0.01"
                                value={formData.premium}
                                onChange={(e) => setFormData({ ...formData, premium: e.target.value })}
                            />
                        </div>



                        <div className="grid gap-2">
                            <Label htmlFor="iv">隱含波動率</Label>
                            <Input
                                id="iv"
                                type="number"
                                step="0.1"
                                value={formData.iv}
                                onChange={(e) => setFormData({ ...formData, iv: e.target.value })}
                            />
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="delta">期權字母 Delta</Label>
                            <Input
                                id="delta"
                                type="number"
                                step="0.001"
                                value={formData.delta}
                                onChange={(e) => setFormData({ ...formData, delta: e.target.value })}
                            />
                        </div>

                    </div>
                    <div className="flex justify-end gap-2 mt-4">
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            取消
                        </Button>
                        <Button type="submit" disabled={isLoading}>
                            {isLoading ? '新增中...' : '新增'}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog >
    );
}
