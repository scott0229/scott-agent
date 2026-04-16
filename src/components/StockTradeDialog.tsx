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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

interface StockTrade {
    id?: number;
    symbol: string;
    note?: string | null;
}

interface StockTradeDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    tradeToEdit?: StockTrade | null;
    onSuccess: () => void;
    year: number; 
}

export function StockTradeDialog({ open, onOpenChange, tradeToEdit, onSuccess }: StockTradeDialogProps) {
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);
    const [note, setNote] = useState("");

    useEffect(() => {
        if (open && tradeToEdit) {
            setNote(tradeToEdit.note || "");
        }
    }, [open, tradeToEdit]);

    const handleSubmit = async () => {
        if (!tradeToEdit || !tradeToEdit.id) return;
        
        try {
            setLoading(true);
            const res = await fetch(`/api/stocks/${tradeToEdit.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: tradeToEdit.id, note }),
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || '儲存失敗');
            }

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
                    <DialogTitle>編輯交易註解</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="flex flex-col gap-2">
                        <Textarea
                            id="note"
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder="輸入任何關於這筆交易的想法或紀錄..."
                            className="min-h-[150px] resize-none focus-visible:ring-1"
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={loading}>
                        取消
                    </Button>
                    <Button type="button" onClick={handleSubmit} disabled={loading}>
                        {loading ? "儲存中..." : "儲存"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
