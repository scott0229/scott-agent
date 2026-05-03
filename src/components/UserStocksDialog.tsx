import React, { useState, useEffect, useMemo } from 'react';
import { format } from "date-fns";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { StockTradesTable, StockTrade, User } from '@/components/StockTradesTable';
import { useToast } from "@/hooks/use-toast";
import { useAdminSettings } from '@/contexts/AdminSettingsContext';
import { Loader2 } from "lucide-react";
import { StockTradeDialog } from '@/components/StockTradeDialog';
import { TransferStockDialog } from '@/components/TransferStockDialog';

interface UserStocksDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    userId: string;
    year: string | number;
}

export function UserStocksDialog({ isOpen, onOpenChange, userId, year }: UserStocksDialogProps) {
    const [trades, setTrades] = useState<StockTrade[]>([]);
    const [loading, setLoading] = useState(true);
    const { toast } = useToast();
    const { settings } = useAdminSettings();
    const [currentUser, setCurrentUser] = useState<User | null>(null);

    const [dialogOpen, setDialogOpen] = useState(false);
    const [tradeToEdit, setTradeToEdit] = useState<StockTrade | null>(null);
    const [transferDialogOpen, setTransferDialogOpen] = useState(false);
    const [tradeToTransfer, setTradeToTransfer] = useState<StockTrade | null>(null);

    useEffect(() => {
        if (isOpen) {
            fetchCurrentUser();
            fetchTrades();
        }
    }, [isOpen, userId, year]);

    const fetchCurrentUser = async () => {
        try {
            const res = await fetch('/api/auth/me');
            if (res.ok) {
                const data = await res.json();
                setCurrentUser(data.user);
            }
        } catch (e) { console.error(e); }
    };

    const fetchTrades = async () => {
        setLoading(true);
        try {
            // We fetch all stocks for this user.
            const yearParam = year === 'All' ? '' : `&year=${year}`;
            const res = await fetch(`/api/stocks?dummy=1${yearParam}`);
            const data = await res.json();
            if (data.stocks) {
                // Filter by the selected userId
                const userTrades = data.stocks.filter((t: StockTrade) => t.user_id === userId);
                setTrades(userTrades);
            }
        } catch (error) {
            console.error('Failed to fetch trades', error);
        } finally {
            setLoading(false);
        }
    };

    const formatDate = (ts: number) => {
        return format(new Date(ts * 1000), "yy-MM-dd");
    };

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

    const sortedTrades = useMemo(() => {
        let result = [...trades];
        // Sort by CloseDate descending, similar to default in Stocks page
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

    const handleToggleIncludeInOptions = async (trade: StockTrade) => {
        let newValue = 0;
        if (trade.include_in_options === 0 || !trade.include_in_options) newValue = 1;
        else if (trade.include_in_options === 1) newValue = 2;
        else newValue = 0;

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

    const displayYear = year === 'All' ? new Date().getFullYear() : (typeof year === 'string' ? parseInt(year) : year);

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent 
                className="sm:max-w-[1400px] w-[95vw] max-h-[90vh] overflow-y-auto"
                onOpenAutoFocus={(e) => e.preventDefault()}
            >
                <DialogHeader>
                    <DialogTitle className="text-xl flex items-center gap-2">
                        {year === 'All' ? new Date().getFullYear() : year} 股票交易紀錄 - {userId}
                        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                    </DialogTitle>
                </DialogHeader>

                <div className="mt-4 relative">
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
                        onEditClick={(trade) => { setTradeToEdit(trade); setDialogOpen(true); }}
                        formatMoney={formatMoney}
                        formatPnL={formatPnL}
                        formatDate={formatDate}
                        hideOwnerColumn={true}
                    />
                </div>

                <StockTradeDialog
                    open={dialogOpen}
                    onOpenChange={setDialogOpen}
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
