'use client';

import { useState, useEffect } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

interface FeesDialogProps {
    userId?: number;
    year: number;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess?: () => void;
}

export function FeesDialog({ userId, year, open, onOpenChange, onSuccess }: FeesDialogProps) {
    const [fees, setFees] = useState<number[]>(Array(12).fill(0));
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const { toast } = useToast();

    // Fetch existing fees data when dialog opens
    useEffect(() => {
        if (open && userId) {
            fetchFees();
        }
    }, [open, userId, year]);

    const fetchFees = async () => {
        if (!userId) return;

        setLoading(true);
        try {
            const res = await fetch(`/api/users/${userId}/fees?year=${year}`);
            if (res.ok) {
                const data = await res.json();
                const feeValues = data.fees.map((item: any) => item.amount || 0);
                setFees(feeValues);
            }
        } catch (error) {
            console.error('Failed to fetch fees:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        if (!userId) return;

        setSaving(true);
        try {
            const feesData = fees.map((amount, index) => ({
                month: index + 1,
                amount: amount || 0
            }));

            const res = await fetch(`/api/users/${userId}/fees`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    year,
                    fees: feesData
                })
            });

            if (res.ok) {
                onSuccess?.();
                onOpenChange(false);
            } else {
                throw new Error('保存失敗');
            }
        } catch (error) {
            toast({
                variant: "destructive",
                title: "保存失敗",
                description: "無法保存管理費數據",
            });
        } finally {
            setSaving(false);
        }
    };

    const handleFeeChange = (month: number, value: string) => {
        const numValue = parseFloat(value) || 0;
        const newFees = [...fees];
        newFees[month] = numValue;
        setFees(newFees);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{year} 年度管理費記錄</DialogTitle>
                </DialogHeader>

                {loading ? (
                    <div className="flex justify-center items-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                ) : (
                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-3 gap-4">
                            {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
                                <div key={month} className="flex flex-col gap-2">
                                    <Label htmlFor={`month-${month}`} className="text-sm">
                                        {month}月
                                    </Label>
                                    <Input
                                        id={`month-${month}`}
                                        type="number"
                                        value={fees[month - 1] || ''}
                                        onChange={(e) => handleFeeChange(month - 1, e.target.value)}
                                        placeholder="0"
                                        step="0.01"
                                        className="[&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        取消
                    </Button>
                    <Button onClick={handleSave} disabled={saving || loading}>
                        {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        保存
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
