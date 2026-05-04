'use client';

import { useState, useEffect, useMemo } from 'react';
import { format } from "date-fns";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { StockTradesTable, StockTrade } from '@/components/StockTradesTable';
import { StockTradeDialog } from '@/components/StockTradeDialog';
import { TransferStockDialog } from '@/components/TransferStockDialog';
import { useAdminSettings } from '@/contexts/AdminSettingsContext';
import { useToast } from "@/hooks/use-toast";

interface UserStockTradesDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    ownerId: number;
    ownerName: string;
    year: string | number;
}

export function UserStockTradesDialog({ isOpen, onOpenChange, ownerId, ownerName, year }: UserStockTradesDialogProps) {
    const [trades, setTrades] = useState<StockTrade[]>([]);
    const [loading, setLoading] = useState(true);
    const [currentUser, setCurrentUser] = useState<any>(null);
    const { settings } = useAdminSettings();
    const { toast } = useToast();

    // Dialogs for editing
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [tradeToEdit, setTradeToEdit] = useState<StockTrade | null>(null);
    const [transferDialogOpen, setTransferDialogOpen] = useState(false);
    const [tradeToTransfer, setTradeToTransfer] = useState<StockTrade | null>(null);

    useEffect(() => {
        if (isOpen && !currentUser) {
            fetch('/api/auth/me').then(res => res.json()).then(data => {
                if (data.user) setCurrentUser(data.user);
            }).catch(console.error);
        }
    }, [isOpen, currentUser]);

    const fetchTrades = async () => {
        if (!isOpen || !ownerId) return;
        setLoading(true);
        try {
            const yearParam = year === 'All' ? '' : `&year=${year}`;
            const q = `ownerId=${ownerId}${yearParam}`;
            const url = `/api/stocks?dummy=1&${q}`;

            const res = await fetch(url);
            const data = await res.json();
            if (data.stocks) {
                setTrades(data.stocks);
            }
        } catch (error) {
            console.error('Failed to fetch trades', error);
            toast({ variant: 'destructive', title: '錯誤', description: '無法載入股票交易紀錄' });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            fetchTrades();
        } else {
            setTrades([]);
        }
    }, [isOpen, ownerId, year]);

    const sortedTrades = useMemo(() => {
        let result = [...trades];
        result.sort((a, b) => {
            const aClose = a.close_date || Number.MAX_SAFE_INTEGER;
            const bClose = b.close_date || Number.MAX_SAFE_INTEGER;
            if (aClose !== bClose) return bClose - aClose; 
            return b.open_date - a.open_date; 
        });
        return result;
    }, [trades]);

    const runningDataMap = useMemo(() => {
        const map: Record<number, { total: number; avgPrice: number | null }> = {};
        const grouped: Record<string, StockTrade[]> = {};
        trades.forEach(t => {
            const key = `${t.user_id}_${t.symbol}`;
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(t);
        });

        Object.values(grouped).forEach(group => {
            group.forEach(t => {
                let total = 0;
                let totalCost = 0;
                group.forEach(l => {
                    if (l.open_date <= t.open_date) {
                        if (!l.close_date || l.close_date > t.open_date) {
                            total += l.quantity;
                            totalCost += l.quantity * l.open_price;
                        }
                    }
                });
                map[t.id] = {
                    total,
                    avgPrice: total > 0 ? totalCost / total : null
                };
            });
        });
        return map;
    }, [trades]);

    const formatMoney = (val: number | null | undefined) => {
        if (val === null || val === undefined) return '-';
        return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
    };

    const formatPnL = (val: number | null | undefined) => {
        if (val === null || val === undefined) return '-';
        return new Intl.NumberFormat('en-US', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(val);
    };

    const formatDate = (ts: number) => {
        return format(new Date(ts * 1000), "yy-MM-dd");
    };

    // Handlers
    const handleToggleIncludeInOptions = async (trade: StockTrade) => {
        let newValue = 0;
        if (trade.include_in_options === 0 || !trade.include_in_options) {
            newValue = 1;
        } else if (trade.include_in_options === 1) {
            newValue = 2;
        } else {
            newValue = 0;
        }
        
        const originalValue = trade.include_in_options;
        setTrades(prev => prev.map(t => t.id === trade.id ? { ...t, include_in_options: newValue } : t));

        try {
            const res = await fetch(`/api/stocks/${trade.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: trade.id, include_in_options: newValue }),
            });
            if (!res.ok) throw new Error('Toggle failed');
        } catch (error) {
            setTrades(prev => prev.map(t => t.id === trade.id ? { ...t, include_in_options: originalValue } : t));
            toast({ variant: 'destructive', title: '操作失敗', description: '無法更新列入期權設定' });
        }
    };

    const handleColorToggle = async (id: number, currentColor: string | null | undefined) => {
        const newColor = (!currentColor || currentColor === 'blue') ? 'red' : currentColor === 'red' ? 'green' : 'blue';
        setTrades(prev => prev.map(t => t.id === id ? { ...t, note_color: newColor } : t));

        try {
            const res = await fetch(`/api/stocks/${id}/note`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ note_color: newColor })
            });
            if (!res.ok) throw new Error('Failed to update note color');
        } catch (error) {
            setTrades(prev => prev.map(t => t.id === id ? { ...t, note_color: currentColor } : t));
            toast({ variant: 'destructive', title: '操作失敗', description: '無法更新註解顏色' });
        }
    };

    const handleNoteUpdate = async (id: number, note: string) => {
        const originalTrades = [...trades];
        setTrades(prev => prev.map(t => t.id === id ? { ...t, note } : t));

        try {
            const res = await fetch(`/api/stocks/${id}/note`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ note }),
            });
            if (!res.ok) throw new Error('Update failed');
        } catch (error) {
            setTrades(originalTrades);
            toast({ variant: 'destructive', title: '操作失敗', description: '無法更新註解' });
        }
    };

    const handleGroupUpdate = async (id: number, newGroupId: string | null) => {
        const originalTrades = [...trades];
        setTrades(prev => prev.map(t => t.id === id ? { ...t, group_id: newGroupId } : t));

        try {
            const res = await fetch(`/api/stocks/${id}/group`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ group_id: newGroupId }),
            });
            if (!res.ok) throw new Error('Update failed');
        } catch (error) {
            setTrades(originalTrades);
            toast({ variant: 'destructive', title: '操作失敗', description: '無法更新群組' });
        }
    };

    const displayYear = year === 'All' ? new Date().getFullYear() : parseInt(year as string);

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[1400px] w-[95vw] max-h-[85vh] flex flex-col p-6">
                <DialogHeader className="mb-4">
                    <DialogTitle className="text-2xl font-bold">{ownerName} 的股票交易 ({year === 'All' ? new Date().getFullYear() : year})</DialogTitle>
                </DialogHeader>
                
                <div className={`flex-1 overflow-auto rounded-md border ${loading ? 'opacity-50 pointer-events-none' : ''}`}>
                    <StockTradesTable 
                        sortedTrades={sortedTrades}
                        runningDataMap={runningDataMap}
                        settings={settings}
                        currentUser={currentUser}
                        onColorToggle={handleColorToggle}
                        onNoteUpdate={handleNoteUpdate}
                        onGroupUpdate={handleGroupUpdate}
                        onToggleIncludeInOptions={handleToggleIncludeInOptions}
                        onTransferClick={(trade) => { setTradeToTransfer(trade); setTransferDialogOpen(true); }}
                        onEditClick={(trade) => { setTradeToEdit(trade); setEditDialogOpen(true); }}
                        formatMoney={formatMoney}
                        formatPnL={formatPnL}
                        formatDate={formatDate}
                        hideOwnerColumn={true}
                    />
                </div>

                <StockTradeDialog
                    open={editDialogOpen}
                    onOpenChange={setEditDialogOpen}
                    tradeToEdit={tradeToEdit}
                    onSuccess={() => { fetchTrades(); }}
                    year={displayYear}
                />

                <TransferStockDialog
                    open={transferDialogOpen}
                    onOpenChange={setTransferDialogOpen}
                    tradeToTransfer={tradeToTransfer}
                    onSuccess={() => { fetchTrades(); }}
                />
            </DialogContent>
        </Dialog>
    );
}
