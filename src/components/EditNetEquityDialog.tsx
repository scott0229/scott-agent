'use client';

import { useState, useEffect } from 'react';
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
}

interface EditNetEquityDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: () => void;
    recordToEdit: PerformanceRecord | null;
}

const formatDateForInput = (timestamp: number | null) => {
    if (!timestamp) return '';
    const d = new Date(timestamp * 1000);
    return d.toISOString().split('T')[0];
};

export function EditNetEquityDialog({ open, onOpenChange, onSuccess, recordToEdit }: EditNetEquityDialogProps) {
    const [formData, setFormData] = useState({
        date: '',
        net_equity: ''
    });
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (recordToEdit) {
            setFormData({
                date: formatDateForInput(recordToEdit.date),
                net_equity: recordToEdit.net_equity.toString()
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
                net_equity: parseFloat(formData.net_equity)
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
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>編輯淨值記錄</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="grid gap-4 py-4">
                    {error && (
                        <div className="bg-red-50 text-red-600 px-4 py-2 rounded-md text-sm border border-red-200">
                            {error}
                        </div>
                    )}

                    <div className="grid gap-2">
                        <Label htmlFor="date">日期</Label>
                        <Input
                            id="date"
                            type="date"
                            value={formData.date}
                            onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                            required
                        />
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="net_equity">帳戶淨值</Label>
                        <Input
                            id="net_equity"
                            type="number"
                            step="0.01"
                            value={formData.net_equity}
                            onChange={(e) => setFormData({ ...formData, net_equity: e.target.value })}
                            required
                        />
                    </div>

                    <div className="flex justify-end gap-2 mt-4">
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            取消
                        </Button>
                        <Button type="submit" disabled={isLoading}>
                            {isLoading ? '更新中...' : '儲存'}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}
