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
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { isMarketHoliday } from '@/lib/holidays';

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
    while (d.getDay() === 0 || d.getDay() === 6 || isMarketHoliday(d)) {
        d.setDate(d.getDate() + 1);
    }
    return d.toISOString().split('T')[0];
};

// Check if a date is weekend (Saturday=6, Sunday=0)
const isWeekend = (dateStr: string): boolean => {
    const d = new Date(dateStr);
    const day = d.getDay();
    return day === 0 || day === 6;
};

// Adjust date to next workday if it's a weekend
const adjustToWorkday = (dateStr: string): string => {
    if (!dateStr) return dateStr;
    const d = new Date(dateStr);
    while (d.getDay() === 0 || d.getDay() === 6 || isMarketHoliday(d)) {
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
    const [isCalendarOpen, setIsCalendarOpen] = useState(false);
    const [isToDateOpen, setIsToDateOpen] = useState(false);
    const [isSettlementDateOpen, setIsSettlementDateOpen] = useState(false);

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
                premium: formData.premium ? parseFloat(formData.premium.toString().replace(/,/g, '')) : 0,
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
                <form onSubmit={handleSubmit} className="grid gap-4">
                    {error && (
                        <div className="bg-red-50 text-red-600 px-4 py-2 rounded-md text-sm border border-red-200">
                            {error}
                        </div>
                    )}
                    <div className="grid grid-cols-2 gap-4">

                        <div className="grid gap-2">
                            <Label htmlFor="status">狀態</Label>
                            <Select
                                value={formData.status}
                                onValueChange={(value) => setFormData({ ...formData, status: value })}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="選擇狀態" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="未平倉">未平倉</SelectItem>
                                    <SelectItem value="已關">已關</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="operation">操作</Label>
                            <Select
                                value={formData.operation}
                                onValueChange={(value) => setFormData({ ...formData, operation: value })}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="選擇操作" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="無">無</SelectItem>
                                    <SelectItem value="滾動">滾動</SelectItem>
                                    <SelectItem value="到期">到期</SelectItem>
                                    <SelectItem value="中途被行權">中途被行權</SelectItem>
                                    <SelectItem value="到期-被行權">到期-被行權</SelectItem>
                                    <SelectItem value="提早平倉">提早平倉</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>


                        <div className="grid gap-2">
                            <Label>開倉日</Label>
                            <Popover modal={true} open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant={"outline"}
                                        type="button"
                                        className={cn(
                                            "w-full justify-start text-left font-normal",
                                            !formData.open_date && "text-muted-foreground"
                                        )}
                                    >
                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                        {formData.open_date ? format(new Date(formData.open_date), "yyyy-MM-dd") : <span>選擇日期</span>}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="start">
                                    <Calendar
                                        mode="single"
                                        selected={formData.open_date ? new Date(formData.open_date) : undefined}
                                        onSelect={(date) => {
                                            if (date) {
                                                const dateStr = format(date, "yyyy-MM-dd");
                                                setFormData({ ...formData, open_date: dateStr });
                                                setError(null);
                                                setIsCalendarOpen(false);
                                            }
                                        }}
                                        disabled={(date) => date.getDay() === 0 || date.getDay() === 6 || isMarketHoliday(date)}
                                        initialFocus
                                    />
                                </PopoverContent>
                            </Popover>
                        </div>

                        <div className="grid gap-2">
                            <Label>到期日</Label>
                            <Popover modal={true} open={isToDateOpen} onOpenChange={setIsToDateOpen}>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant={"outline"}
                                        type="button"
                                        className={cn(
                                            "w-full justify-start text-left font-normal",
                                            !formData.to_date && "text-muted-foreground"
                                        )}
                                    >
                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                        {formData.to_date ? format(new Date(formData.to_date), "yyyy-MM-dd") : <span>選擇日期</span>}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="start">
                                    <Calendar
                                        mode="single"
                                        selected={formData.to_date ? new Date(formData.to_date) : undefined}
                                        onSelect={(date) => {
                                            if (date) {
                                                const dateStr = format(date, "yyyy-MM-dd");
                                                setFormData(prev => ({
                                                    ...prev,
                                                    to_date: dateStr,
                                                    // If settlement date hasn't been manually modified, auto-update it
                                                    settlement_date: !isSettlementDateDirty ? dateStr : prev.settlement_date
                                                }));
                                                setError(null);
                                                setIsToDateOpen(false);
                                            }
                                        }}
                                        fromDate={formData.open_date ? new Date(formData.open_date) : undefined}
                                        disabled={(date) => date.getDay() === 0 || date.getDay() === 6 || isMarketHoliday(date)}
                                        initialFocus
                                    />
                                </PopoverContent>
                            </Popover>
                        </div>



                        <div className="grid gap-2">
                            <Label>結算日</Label>
                            <Popover modal={true} open={isSettlementDateOpen} onOpenChange={setIsSettlementDateOpen}>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant={"outline"}
                                        type="button"
                                        className={cn(
                                            "w-full justify-start text-left font-normal",
                                            !formData.settlement_date && "text-muted-foreground"
                                        )}
                                    >
                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                        {formData.settlement_date ? format(new Date(formData.settlement_date), "yyyy-MM-dd") : <span>選擇日期</span>}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="start">
                                    <Calendar
                                        mode="single"
                                        selected={formData.settlement_date ? new Date(formData.settlement_date) : undefined}
                                        onSelect={(date) => {
                                            if (date) {
                                                const dateStr = format(date, "yyyy-MM-dd");
                                                setFormData({ ...formData, settlement_date: dateStr });
                                                setIsSettlementDateDirty(true);
                                                setError(null);
                                                setIsSettlementDateOpen(false);
                                            }
                                        }}
                                        fromDate={formData.to_date ? new Date(formData.to_date) : undefined}
                                        disabled={(date) => date.getDay() === 0 || date.getDay() === 6 || isMarketHoliday(date)}
                                        initialFocus
                                    />
                                </PopoverContent>
                            </Popover>
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="quantity">口數</Label>
                            <Input
                                id="quantity"
                                type="number"
                                value={formData.quantity}
                                onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                            />
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="underlying">標的</Label>
                            <Input
                                id="underlying"
                                value={formData.underlying}
                                onChange={(e) => setFormData({ ...formData, underlying: e.target.value.toUpperCase() })}
                            />
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="type">類型</Label>
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
                            <Label htmlFor="strike_price">行權價</Label>
                            <Input
                                id="strike_price"
                                type="number"
                                step="0.01"
                                value={formData.strike_price}
                                onChange={(e) => setFormData({ ...formData, strike_price: e.target.value })}
                            />
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="premium">權利金</Label>
                            <Input
                                id="premium"
                                type="text"
                                value={formData.premium}
                                onChange={(e) => {
                                    const value = e.target.value;
                                    const cleanValue = value.replace(/,/g, '');
                                    if (/^-?\d*\.?\d*$/.test(cleanValue)) {
                                        const parts = cleanValue.split('.');
                                        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
                                        setFormData({ ...formData, premium: parts.join('.') });
                                    }
                                }}
                            />
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="iv">隱含波動率</Label>
                            <Input
                                id="iv"
                                type="number"
                                step="0.01"
                                value={formData.iv}
                                onChange={(e) => setFormData({ ...formData, iv: e.target.value })}
                            />
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="delta">Delta</Label>
                            <Input
                                id="delta"
                                type="number"
                                step="0.01"
                                value={formData.delta}
                                onChange={(e) => setFormData({ ...formData, delta: e.target.value })}
                            />
                        </div>
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
                            取消
                        </Button>
                        <Button type="submit" disabled={isLoading}>
                            {isLoading ? '新增中...' : '新增'}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}
