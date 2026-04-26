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

interface Option {
    id: number | string;
    type: string;
}

interface BatchSetGroupDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    sortedOptions: Option[];
    onSuccess: () => void;
}

export function BatchSetGroupDialog({ open, onOpenChange, sortedOptions, onSuccess }: BatchSetGroupDialogProps) {
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);
    const [startNo, setStartNo] = useState<string>('');
    const [endNo, setEndNo] = useState<string>('');
    const [selectedGroup, setSelectedGroup] = useState<string>('');

    const handleSubmit = async () => {
        const start = parseInt(startNo, 10);
        const end = parseInt(endNo, 10);
        
        if (isNaN(start) || isNaN(end)) {
            toast({ variant: "destructive", title: "操作失敗", description: "請輸入有效的起始與終止 NO" });
            return;
        }
        
        if (!selectedGroup) {
            toast({ variant: "destructive", title: "操作失敗", description: "請選擇群組" });
            return;
        }

        const minNo = Math.min(start, end);
        const maxNo = Math.max(start, end);

        const targetOptions = sortedOptions.filter((_, index) => {
            const rowNo = sortedOptions.length - index;
            return rowNo >= minNo && rowNo <= maxNo;
        });

        if (targetOptions.length === 0) {
            toast({ variant: "destructive", title: "操作失敗", description: "找不到符合範圍的資料" });
            return;
        }

        try {
            setLoading(true);
            const groupId = selectedGroup === "none" ? null : selectedGroup;
            
            // Execute in batches or all together (Promise.all)
            await Promise.all(targetOptions.map(async (opt) => {
                const isStock = opt.type === 'STK';
                const realId = isStock ? String(opt.id).split('-')[1] : opt.id;
                const tradeSide = isStock ? String(opt.id).split('-')[2] : null;
                const apiPath = isStock ? `/api/stocks/${realId}/group` : `/api/options/${realId}/group`;
                
                const res = await fetch(apiPath, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ group_id: groupId, tradeSide })
                });
                
                if (!res.ok) throw new Error(`Failed to update ${opt.id}`);
            }));

            onSuccess();
            onOpenChange(false);
            setStartNo('');
            setEndNo('');
            setSelectedGroup('');
        } catch (error: any) {
            console.error(error);
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
                    <DialogTitle>批次設群</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="start-no" className="text-right">
                            起始 NO
                        </Label>
                        <Input
                            id="start-no"
                            type="number"
                            value={startNo}
                            onChange={(e) => setStartNo(e.target.value)}
                            className="col-span-3"
                            placeholder="例如: 1"
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="end-no" className="text-right">
                            終止 NO
                        </Label>
                        <Input
                            id="end-no"
                            type="number"
                            value={endNo}
                            onChange={(e) => setEndNo(e.target.value)}
                            className="col-span-3"
                            placeholder="例如: 10"
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="target-group" className="text-right">
                            目標群組
                        </Label>
                        <div className="col-span-3">
                            <Select
                                value={selectedGroup}
                                onValueChange={(value) => setSelectedGroup(value)}
                            >
                                <SelectTrigger id="target-group">
                                    <SelectValue placeholder="選擇群組" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none" className="text-muted-foreground">清除群組 (-)</SelectItem>
                                    {[
                                        'QQQ-0', 'QQQ-1', 'QQQ-2', 'QQQ-3', 'QQQ-4', 'QQQ-5',
                                        'TQQQ-0', 'TQQQ-1', 'TQQQ-2', 'TQQQ-3', 'TQQQ-4', 'TQQQ-5',
                                        'GROUP-0', 'GROUP-1', 'GROUP-2', 'GROUP-3', 'GROUP-4', 'GROUP-5'
                                    ].map(n => (
                                        <SelectItem key={n} value={n}>{n}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
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
