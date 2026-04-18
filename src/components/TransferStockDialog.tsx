'use client';

import { useState } from "react";
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

interface StockTrade {
    id: number;
    symbol: string;
}

interface TransferStockDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    tradeToTransfer?: StockTrade | null;
    onSuccess: () => void;
}

export function TransferStockDialog({ open, onOpenChange, tradeToTransfer, onSuccess }: TransferStockDialogProps) {
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);
    
    // Default to today's date
    const today = new Date();
    const defaultDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const [transferDateStr, setTransferDateStr] = useState(defaultDate);

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
            const res = await fetch(`/api/stocks/${tradeToTransfer.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    id: tradeToTransfer.id, 
                    action: 'transfer',
                    close_date: closeDateUnix
                }),
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || '儲存失敗');
            }

            toast({
                title: "操作成功",
                description: `已將 ${tradeToTransfer.symbol} 標記為轉倉`,
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
                    <DialogTitle>手動標記轉倉</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <p className="text-sm text-muted-foreground mb-2">
                        這將手動幫您平倉 <span className="font-bold text-primary">{tradeToTransfer?.symbol}</span>，並且強制設定平倉盈虧為 0。這個操作主要用於標記那些被內部過戶出該帳號的持倉。
                    </p>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="transfer-date" className="text-right">
                            轉倉日期
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
                        {loading ? "處理中..." : "確認轉倉"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
