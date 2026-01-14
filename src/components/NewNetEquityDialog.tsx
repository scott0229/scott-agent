'use client';

import { useState } from 'react';
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

interface NewNetEquityDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    userId: number;
    year: string | number;
    onSuccess: () => void;
}

export function NewNetEquityDialog({ open, onOpenChange, userId, year: selectedYear, onSuccess }: NewNetEquityDialogProps) {
    const getDefaultDate = () => {
        const d = new Date();
        const day = d.getDay();
        if (day === 6) { // Saturday -> Monday
            d.setDate(d.getDate() + 2);
        } else if (day === 0) { // Sunday -> Monday
            d.setDate(d.getDate() + 1);
        }
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const dayStr = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${dayStr}`;
    };

    const [date, setDate] = useState(getDefaultDate);
    const [equity, setEquity] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const { toast } = useToast();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);

        try {
            // Convert date string (YYYY-MM-DD) to Unix Timestamp (seconds) at 00:00:00 UTC?
            // User input is local YYYY-MM-DD from browser input date.
            // Let's create a Date object and get timestamp.
            // Be careful with timezones.
            // If user selects 2026-01-01, input value is "2026-01-01".
            // new Date("2026-01-01") creates UTC midnight.
            const dateObj = new Date(date);
            // We want strict alignment. Using standardized UTC midnight for "Daily" records is safest.
            const timestamp = dateObj.getTime() / 1000;

            const res = await fetch('/api/net-equity', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: userId,
                    date: timestamp,
                    net_equity: parseFloat(equity),
                    year: selectedYear !== 'All' ? selectedYear : undefined
                }),
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to create record');
            }

            toast({
                title: "記錄已新增",
                description: "淨值記錄已成功保存",
            });

            onSuccess();
            onOpenChange(false);
            setEquity('');
            setDate(getDefaultDate()); // Reset to default date instead of empty
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "錯誤",
                description: error.message,
            });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>新增帳戶淨值</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4 pt-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="date" className="text-right">
                            交易日
                        </Label>
                        <Input
                            id="date"
                            type="date"
                            className="col-span-3"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            required
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="equity" className="text-right">
                            淨值
                        </Label>
                        <Input
                            id="equity"
                            type="number"
                            step="0.01"
                            placeholder="輸入金額"
                            className="col-span-3"
                            value={equity}
                            onChange={(e) => setEquity(e.target.value)}
                            required
                        />
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            取消
                        </Button>
                        <Button type="submit" disabled={isLoading}>
                            {isLoading ? "保存中..." : "保存"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
