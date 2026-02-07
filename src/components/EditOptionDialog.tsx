'use client';

import { useState, useEffect } from 'react';
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


interface Option {
    id: number;
    status: string;
    operation: string | null;
    open_date: number;
    to_date: number | null;
    settlement_date: number | null;
    quantity: number;
    underlying: string;
    type: string;
    strike_price: number;
    collateral: number | null;
    premium: number | null;
    final_profit: number | null;
    profit_percent: number | null;
    delta: number | null;
    iv: number | null;
    capital_efficiency: number | null;
}

interface EditOptionDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: () => void;
    optionToEdit: Option | null;
}

const formatDateForInput = (timestamp: number | null) => {
    if (!timestamp) return '';
    // Use local time for input value consistent with NewOptionDialog behavior
    const d = new Date(timestamp * 1000);
    return d.toISOString().split('T')[0];
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

// Format number with thousand separators
const formatNumberWithCommas = (value: number | null | undefined): string => {
    if (value === null || value === undefined) return '';
    const str = value.toString();
    const parts = str.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
};

export function EditOptionDialog({ open, onOpenChange, onSuccess, optionToEdit }: EditOptionDialogProps) {
    const { selectedYear } = useYearFilter();
    const [formData, setFormData] = useState({
        operation: 'Open',
        open_date: '',
        to_date: '',
        settlement_date: '',
        quantity: '',
        underlying: '',
        type: 'CALL',
        strike_price: '',
        premium: '',
        collateral: '',
        iv: '',
        delta: '',
        final_profit: ''
    });
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isCalendarOpen, setIsCalendarOpen] = useState(false);
    const [isToDateOpen, setIsToDateOpen] = useState(false);
    const [isSettlementDateOpen, setIsSettlementDateOpen] = useState(false);

    useEffect(() => {
        if (optionToEdit) {
            setFormData({
                operation: optionToEdit.operation || 'Open',
                open_date: formatDateForInput(optionToEdit.open_date),
                to_date: formatDateForInput(optionToEdit.to_date),
                settlement_date: formatDateForInput(optionToEdit.settlement_date),
                quantity: optionToEdit.quantity.toString(),
                underlying: optionToEdit.underlying,
                type: optionToEdit.type,
                strike_price: formatNumberWithCommas(optionToEdit.strike_price),
                premium: formatNumberWithCommas(optionToEdit.premium),
                collateral: optionToEdit.collateral?.toString() || '',
                iv: optionToEdit.iv?.toString() || '',
                delta: optionToEdit.delta?.toString() || '',
                final_profit: formatNumberWithCommas(optionToEdit.final_profit)
            });
        }
    }, [optionToEdit]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!optionToEdit) return;

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
                id: optionToEdit.id,
                ...formData,
                open_date: Math.floor(new Date(formData.open_date).getTime() / 1000),
                to_date: formData.to_date ? Math.floor(new Date(formData.to_date).getTime() / 1000) : null,
                settlement_date: (formData.operation !== 'Open' && formData.settlement_date) ? Math.floor(new Date(formData.settlement_date).getTime() / 1000) : null,
                quantity: parseFloat(formData.quantity.toString().replace(/,/g, '')),
                strike_price: parseFloat(formData.strike_price.toString().replace(/,/g, '')),
                premium: formData.premium ? parseFloat(formData.premium.toString().replace(/,/g, '')) : 0,
                // Recalculate collateral on edit? Or keep existing logic? 
                // Maintaining "auto-calculate" logic as per new creation
                collateral: Math.abs(parseFloat(formData.quantity.toString().replace(/,/g, ''))) * parseFloat(formData.strike_price.toString().replace(/,/g, '')) * 100,
                iv: formData.iv ? parseFloat(formData.iv) : null,
                delta: formData.delta ? parseFloat(formData.delta) : null,
                final_profit: formData.final_profit ? parseFloat(formData.final_profit.toString().replace(/,/g, '')) : null,
            };

            const res = await fetch('/api/options', {
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
            console.error('Failed to update option', error);
            setError('發生錯誤，請稍後再試');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>編輯交易</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4" autoComplete="off">
                    {error && (
                        <div className="col-span-2 bg-red-50 text-red-600 px-4 py-2 rounded-md text-sm border border-red-200">
                            {error}
                        </div>
                    )}

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
                                <SelectItem value="Open">Open</SelectItem>
                                <SelectItem value="Closed">Closed</SelectItem>
                                <SelectItem value="Expired">Expired</SelectItem>
                                <SelectItem value="Assigned">Assigned</SelectItem>
                                <SelectItem value="Exercised">Exercised</SelectItem>
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
                                                // Assuming we don't have isSettlementDateDirty logic here as per existing code, or simplified
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
                                    disabled={formData.operation === 'Open'}
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
                            type="text"
                            value={formData.strike_price}
                            onChange={(e) => {
                                setFormData({ ...formData, strike_price: e.target.value });
                            }}
                            onFocus={(e) => {
                                const cleanValue = e.target.value.replace(/,/g, '');
                                setFormData({ ...formData, strike_price: cleanValue });
                            }}
                            onBlur={(e) => {
                                const cleanValue = e.target.value.replace(/,/g, '');
                                if (cleanValue && /^-?\d*\.?\d*$/.test(cleanValue)) {
                                    const parts = cleanValue.split('.');
                                    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
                                    setFormData({ ...formData, strike_price: parts.join('.') });
                                }
                            }}
                        />
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="premium">權利金</Label>
                        <Input
                            id="premium"
                            type="text"
                            value={formData.premium}
                            onChange={(e) => {
                                setFormData({ ...formData, premium: e.target.value });
                            }}
                            onFocus={(e) => {
                                const cleanValue = e.target.value.replace(/,/g, '');
                                setFormData({ ...formData, premium: cleanValue });
                            }}
                            onBlur={(e) => {
                                const cleanValue = e.target.value.replace(/,/g, '');
                                if (cleanValue && /^-?\d*\.?\d*$/.test(cleanValue)) {
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

                    <div className="grid gap-2">
                        <Label htmlFor="final_profit" className="text-right">
                            已實現損益
                        </Label>
                        <Input
                            id="final_profit"
                            type="text"
                            value={formData.final_profit}
                            onChange={(e) => {
                                setFormData({ ...formData, final_profit: e.target.value });
                            }}
                            onFocus={(e) => {
                                const cleanValue = e.target.value.replace(/,/g, '');
                                setFormData({ ...formData, final_profit: cleanValue });
                            }}
                            onBlur={(e) => {
                                const cleanValue = e.target.value.replace(/,/g, '');
                                if (cleanValue && /^-?\d*\.?\d*$/.test(cleanValue)) {
                                    const parts = cleanValue.split('.');
                                    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
                                    setFormData({ ...formData, final_profit: parts.join('.') });
                                }
                            }}
                        />
                    </div>
                    <div className="flex justify-end gap-2 col-span-2">
                        <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
                            取消
                        </Button>
                        <Button type="submit" disabled={isLoading}>
                            {isLoading ? '更新中...' : '更新'}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}
