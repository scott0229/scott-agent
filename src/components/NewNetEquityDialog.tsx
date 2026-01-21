'use client';

import { useState, useEffect, useRef } from 'react';
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

    // Don't format if empty (unless it's just 0 or similar, but integerPart check usually handles empty string)
    // Actually, if integerPart is empty but we have decimal (e.g. .5), we might want to keep it or prefix 0.
    // Existing logic was: if (!integerPart) return ''; which implies .5 -> empty. Let's stick to existing behavior for now but safeguard.

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

export function NewNetEquityDialog({ open, onOpenChange, userId, year: selectedYear, onSuccess }: NewNetEquityDialogProps) {
    // Calculate next business day from a given date
    const getNextBusinessDay = (fromDate: Date): string => {
        const d = new Date(fromDate);
        d.setDate(d.getDate() + 1); // Start from next day
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

    const [date, setDate] = useState('');
    const [equity, setEquity] = useState('');
    const [cashBalance, setCashBalance] = useState('');
    const [managementFee, setManagementFee] = useState('');
    const [deposit, setDeposit] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const { toast } = useToast();
    const isComposing = useRef(false);

    // Fetch latest record and set default date when dialog opens
    useEffect(() => {
        if (open && userId) {
            // Fetch ALL records (no year filter) to get the absolute latest record
            fetch(`/api/net-equity?userId=${userId}`)
                .then(res => res.json())
                .then(data => {
                    if (data.data && data.data.length > 0) {
                        // Get the most recent record (API returns sorted by date DESC)
                        const latestRecord = data.data[0];
                        const latestDate = new Date(latestRecord.date * 1000);
                        setDate(getNextBusinessDay(latestDate));
                    } else {
                        // No records, default to next business day from today
                        setDate(getNextBusinessDay(new Date()));
                    }
                })
                .catch(() => {
                    // On error, fallback to next business day from today
                    setDate(getNextBusinessDay(new Date()));
                });
        }
    }, [open, userId]);

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
                    net_equity: parseNumber(equity),
                    cash_balance: cashBalance ? parseNumber(cashBalance) : null,
                    deposit: deposit ? parseNumber(deposit) : 0,
                    management_fee: managementFee ? parseNumber(managementFee) : 0,
                    year: selectedYear !== 'All' ? selectedYear : undefined
                }),
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to create record');
            }



            onSuccess();
            onOpenChange(false);
            setEquity('');
            setCashBalance('');
            setManagementFee('');
            setDeposit('');
            setDate(getNextBusinessDay(new Date())); // Reset to fallback date
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
                <form onSubmit={handleSubmit} className="grid gap-4">
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
                            type="text"
                            className="col-span-3"
                            value={equity}
                            onCompositionStart={() => isComposing.current = true}
                            onCompositionEnd={(e) => {
                                isComposing.current = false;
                                setEquity(formatNumber(e.currentTarget.value));
                            }}
                            onChange={(e) => {
                                if (isComposing.current) {
                                    setEquity(e.target.value);
                                    return;
                                }
                                const formatted = formatNumber(e.target.value);
                                setEquity(formatted);
                            }}
                            required
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="cashBalance" className="text-right">
                            帳戶現金
                        </Label>
                        <Input
                            id="cashBalance"
                            type="text"
                            className="col-span-3"
                            value={cashBalance}
                            onCompositionStart={() => isComposing.current = true}
                            onCompositionEnd={(e) => {
                                isComposing.current = false;
                                setCashBalance(formatNumber(e.currentTarget.value));
                            }}
                            onChange={(e) => {
                                if (isComposing.current) {
                                    setCashBalance(e.target.value);
                                    return;
                                }
                                const formatted = formatNumber(e.target.value);
                                setCashBalance(formatted);
                            }}
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="managementFee" className="text-right">
                            管理費支出
                        </Label>
                        <Input
                            id="managementFee"
                            type="text"
                            className="col-span-3"
                            value={managementFee}
                            onCompositionStart={() => isComposing.current = true}
                            onCompositionEnd={(e) => {
                                isComposing.current = false;
                                setManagementFee(formatNumber(e.currentTarget.value));
                            }}
                            onChange={(e) => {
                                if (isComposing.current) {
                                    setManagementFee(e.target.value);
                                    return;
                                }
                                const formatted = formatNumber(e.target.value);
                                setManagementFee(formatted);
                            }}
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="deposit" className="text-right">
                            轉帳記錄
                        </Label>
                        <Input
                            id="deposit"
                            type="text"
                            className="col-span-3"
                            value={deposit}
                            onCompositionStart={() => isComposing.current = true}
                            onCompositionEnd={(e) => {
                                isComposing.current = false;
                                setDeposit(formatNumber(e.currentTarget.value));
                            }}
                            onChange={(e) => {
                                if (isComposing.current) {
                                    setDeposit(e.target.value);
                                    return;
                                }
                                const formatted = formatNumber(e.target.value);
                                setDeposit(formatted);
                            }}
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
