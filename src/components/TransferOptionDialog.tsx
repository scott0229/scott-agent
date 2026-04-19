'use client';

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

interface OptionTrade {
    id: number | string;
    underlying: string;
    type: string;
    strike_price: number;
    settlement_date?: number | null;
    operation?: string | null;
}

interface TransferOptionDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    tradeToTransfer?: OptionTrade | null;
    onSuccess: () => void;
}

export function TransferOptionDialog({ open, onOpenChange, tradeToTransfer, onSuccess }: TransferOptionDialogProps) {
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);
    
    // Default to today's date
    const today = new Date();
    const defaultDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const [transferDateStr, setTransferDateStr] = useState(defaultDate);
    const [operationType, setOperationType] = useState('Transferred');

    useEffect(() => {
        if (open) {
            if (tradeToTransfer && tradeToTransfer.settlement_date) {
                // If it already has a settlement date (e.g. from a previous transfer), use it
                const initDate = new Date(tradeToTransfer.settlement_date * 1000);
                setTransferDateStr(`${initDate.getFullYear()}-${String(initDate.getMonth() + 1).padStart(2, '0')}-${String(initDate.getDate()).padStart(2, '0')}`);
            } else {
                setTransferDateStr(defaultDate);
            }
            if (tradeToTransfer && tradeToTransfer.operation) {
                setOperationType(tradeToTransfer.operation);
            } else {
                setOperationType('Transferred');
            }
        }
    }, [open, tradeToTransfer]);

    const handleSubmit = async () => {
        if (!tradeToTransfer || !tradeToTransfer.id) return;
        if (!transferDateStr) {
            toast({ variant: "destructive", title: "操作失敗", description: "請選擇轉倉日期" });
            return;
        }
        
        // Convert YYYY-MM-DD back to unix timestamp
        const [yyyy, mm, dd] = transferDateStr.split('-');
        const closeDateUnix = Math.floor(new Date(Date.UTC(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd))).getTime() / 1000);
        
        try {
            setLoading(true);
            const res = await fetch(`/api/options/${tradeToTransfer.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    id: tradeToTransfer.id, 
                    action: 'transfer',
                    settlement_date: closeDateUnix,
                    operation_type: operationType
                }),
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || '儲存失敗');
            }

            toast({
                title: "操作成功",
                description: `已變更期權操作狀態`,
            });
            onSuccess();
            onOpenChange(false);
        } catch (error: any) {
            console.error(error.message);
            toast({
                variant: "destructive",
                title: "操作失敗",
                description: error.message || "未知錯誤",
            });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>變更操作</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="operation-type" className="text-right">
                            操作類型
                        </Label>
                        <div className="col-span-3">
                            <Select
                                value={operationType}
                                onValueChange={(value) => setOperationType(value)}
                            >
                                <SelectTrigger id="operation-type">
                                    <SelectValue placeholder="選擇操作" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Transferred">Transferred</SelectItem>
                                    <SelectItem value="Closed">Closed</SelectItem>
                                    <SelectItem value="Expired">Expired</SelectItem>
                                    <SelectItem value="Assigned">Assigned</SelectItem>
                                    <SelectItem value="Exercised">Exercised</SelectItem>
                                    <SelectItem value="Open">Open</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="transfer-date" className="text-right">
                            平倉日
                        </Label>
                        <Input
                            id="transfer-date"
                            type="date"
                            value={transferDateStr}
                            onChange={(e) => setTransferDateStr(e.target.value)}
                            className="col-span-3"
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={loading}>
                        取消
                    </Button>
                    <Button type="button" onClick={handleSubmit} disabled={loading}>
                        {loading ? "處理中..." : "確認變更"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
