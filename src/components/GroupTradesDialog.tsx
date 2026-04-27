import React, { useState, useEffect } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useAdminSettings } from '@/contexts/AdminSettingsContext';
import { useToast } from "@/hooks/use-toast";

const formatDate = (timestamp: number | null) => {
    if (!timestamp) return '';
    const date = new Date(timestamp * 1000);
    const year = date.getFullYear().toString().slice(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const formatOptionTicker = (opt: any) => {
    const underlying = opt.underlying;
    if (opt.type === 'STK') {
        const assignedText = opt.is_assigned ? '，被行權' : '';
        return opt.underlying_price != null ? `${underlying} (均價 ${opt.underlying_price.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}${assignedText})` : `${underlying}${assignedText}`;
    }
    const typeChar = opt.type === 'PUT' ? 'P' : 'C';
    const strike = opt.strike_price;
    if (!opt.to_date) return `${underlying} - ${strike}${typeChar}`;
    const d = new Date(opt.to_date * 1000);
    const mon = MONTH_ABBR[d.getMonth()];
    const day = d.getDate();
    const yr = d.getFullYear().toString().slice(-2);
    return `${underlying} ${mon}${day}'${yr} ${strike}${typeChar}`;
};

const calculateDays = (start: number, end: number | null) => {
    if (!end) return '';
    const diffTime = Math.abs(end * 1000 - start * 1000);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

const SEPARATOR_COLORS = [
    '', // 0: None
    'border-orange-200',  // 1: Orange
    'border-blue-300',    // 2: Blue
    'border-green-500'    // 3: Green
];

export function GroupTradesDialog({
    isOpen,
    onOpenChange,
    groupName,
    ownerName,
    trades,
}: {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    groupName: string;
    ownerName?: string;
    trades: any[];
}) {
    const { settings } = useAdminSettings();
    const { toast } = useToast();
    const [localTrades, setLocalTrades] = useState<any[]>(trades);

    useEffect(() => {
        setLocalTrades(trades);
    }, [trades]);

    const handleNoteUpdate = async (trade: any, newNote: string) => {
        const previousNote = trade.note;
        if (previousNote === newNote) return;

        // Optimistic update
        setLocalTrades(prev => prev.map(t => 
            t.id === trade.id && t.type === trade.type 
                ? { ...t, note: newNote } 
                : t
        ));

        try {
            const endpoint = trade.type === 'STK' ? `/api/stocks/${trade.id}/note` : `/api/options/${trade.id}/note`;
            const res = await fetch(endpoint, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ note: newNote })
            });

            if (!res.ok) throw new Error('Failed to update note');
            
            // Mutate the original array as well so it persists if dialog closes and reopens
            const originalTrade = trades.find(t => t.id === trade.id && t.type === trade.type);
            if (originalTrade) originalTrade.note = newNote;
        } catch (error) {
            console.error('Failed to update note:', error);
            // Revert on error
            setLocalTrades(prev => prev.map(t => 
                t.id === trade.id && t.type === trade.type 
                    ? { ...t, note: previousNote } 
                    : t
            ));
            toast({
                title: "更新失敗",
                description: "無法儲存註解，請稍後再試。",
                variant: "destructive",
            });
        }
    };

    const handleNoteColorToggle = async (trade: any) => {
        if (!trade.note?.trim()) return;
        
        const previousColor = trade.note_color;
        const colorCycle = {
            'blue': 'red',
            'red': 'green',
            'green': 'blue'
        };
        const newColor = colorCycle[(trade.note_color as 'blue' | 'red' | 'green') || 'blue'];

        // Optimistic update
        setLocalTrades(prev => prev.map(t => 
            t.id === trade.id && t.type === trade.type 
                ? { ...t, note_color: newColor } 
                : t
        ));

        try {
            const endpoint = trade.type === 'STK' ? `/api/stocks/${trade.id}/note` : `/api/options/${trade.id}/note`;
            const res = await fetch(endpoint, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ note_color: newColor })
            });

            if (!res.ok) throw new Error('Failed to update note color');
            
            // Mutate original array
            const originalTrade = trades.find(t => t.id === trade.id && t.type === trade.type);
            if (originalTrade) originalTrade.note_color = newColor;
        } catch (error) {
            console.error('Failed to update note color:', error);
            setLocalTrades(prev => prev.map(t => 
                t.id === trade.id && t.type === trade.type 
                    ? { ...t, note_color: previousColor } 
                    : t
            ));
            toast({
                title: "更新失敗",
                description: "無法儲存顏色設定，請稍後再試。",
                variant: "destructive",
            });
        }
    };

    // Sort trades: strictly by open_date desc
    const sortedOptions = [...localTrades].sort((a, b) => {
        return b.open_date - a.open_date;
    });

    const totalPnL = sortedOptions.reduce((sum, opt) => sum + (opt.final_profit ? opt.final_profit : 0), 0);
    const formattedPnL = totalPnL > 0 ? `+${Math.round(totalPnL).toLocaleString('en-US')}` : (totalPnL < 0 ? Math.round(totalPnL).toLocaleString('en-US') : '');

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[1500px] max-h-[85vh] overflow-y-auto" onOpenAutoFocus={(e) => e.preventDefault()}>
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        {ownerName ? `${ownerName} 群組 ${groupName}` : `群組交易明細 - ${groupName}`}
                    </DialogTitle>
                </DialogHeader>
                
                <div className="bg-white rounded-lg shadow-sm border overflow-x-auto mt-4">
                    <Table className="whitespace-nowrap">
                        <TableHeader>
                            <TableRow className="bg-secondary hover:bg-secondary">
                                <TableHead className="text-center"></TableHead>
                                <TableHead className="text-left"></TableHead>
                                <TableHead className="text-center w-[110px]"></TableHead>
                                <TableHead className="text-center">操作</TableHead>
                                <TableHead className="text-center">開倉日</TableHead>
                                <TableHead className="text-center">平倉日</TableHead>
                                <TableHead className="text-center">數量</TableHead>
                                <TableHead className="text-center">標的</TableHead>
                                <TableHead className="text-center">當時股價</TableHead>
                                {settings.showPremium && <TableHead className="text-center">權利金</TableHead>}
                                <TableHead className="text-center">損益</TableHead>
                                {settings.showTradeCode && <TableHead className="text-center">交易代碼</TableHead>}
                                <TableHead className="text-center whitespace-nowrap min-w-[75px] px-2">
                                    {formattedPnL && <span className={totalPnL > 0 ? 'text-green-700 font-medium' : 'text-red-600 font-medium'}>{formattedPnL}</span>}
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {sortedOptions.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={14} className="text-center py-8 text-muted-foreground">
                                        尚無交易
                                    </TableCell>
                                </TableRow>
                            ) : (
                                sortedOptions.map((opt, index) => {
                                    return (
                                        <TableRow
                                            key={opt.id}
                                            className={`text-center transition-colors h-[40px] ${opt.type === 'STK' ? 'bg-blue-50' : 'hover:bg-muted/50'} ${opt.has_separator ? `border-t-4 ${SEPARATOR_COLORS[typeof opt.has_separator === 'number' ? opt.has_separator : 1] || 'border-orange-200'}` : ''}`}
                                        >
                                            <TableCell className="py-1">
                                                <div className="flex items-center justify-center gap-4">
                                                    <span>{sortedOptions.length - index}</span>
                                                    {opt.note?.trim() ? (
                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.preventDefault();
                                                                handleNoteColorToggle(opt);
                                                            }}
                                                            className={`w-4 h-4 rounded-full shrink-0 cursor-pointer shadow-sm transition-colors opacity-90 hover:opacity-100 ${
                                                                opt.note_color === 'red' ? 'bg-red-500' : opt.note_color === 'green' ? 'bg-green-600' : 'bg-blue-500'
                                                            }`}
                                                            title="切換註解顏色"
                                                        />
                                                    ) : (
                                                        <div className="w-4 h-4 shrink-0" />
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell className="py-1 min-w-[180px]">
                                                <input 
                                                    type="text"
                                                    className="w-full bg-transparent border-none focus:ring-0 focus:outline-none px-1 text-left text-[13px] font-medium truncate max-w-[200px]"
                                                    style={{ color: opt.note_color === 'red' ? '#7f1d1d' : opt.note_color === 'green' ? '#15803d' : '#1e3a8a' }}
                                                    defaultValue={opt.note || ''}
                                                    placeholder="..."
                                                    onBlur={(e) => handleNoteUpdate(opt, e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            e.currentTarget.blur();
                                                        }
                                                    }}
                                                />
                                            </TableCell>
                                            <TableCell className="py-1 min-w-[110px]">
                                                <div className={`w-[80px] mx-auto h-7 flex items-center justify-center rounded-md font-normal text-[13px] ${
                                                    opt.group_id && String(opt.group_id).endsWith('-0') 
                                                        ? 'bg-yellow-100' 
                                                        : opt.group_id && String(opt.group_id).endsWith('-2')
                                                            ? 'bg-green-100'
                                                            : 'bg-slate-100'
                                                }`}>
                                                    {opt.group_id || '-'}
                                                </div>
                                            </TableCell>
                                            <TableCell className="py-1 min-w-[100px]">
                                                {opt.operation === 'Open' || !opt.operation ? (
                                                    <Badge variant="outline" className="border-slate-300 text-slate-600 bg-white shadow-sm font-medium">Open</Badge>
                                                ) : opt.operation === 'Assigned' ? (
                                                    <Badge variant="destructive" className="bg-red-50 text-red-600 hover:bg-red-100 border-none shadow-sm font-medium">Assigned</Badge>
                                                ) : opt.operation === 'Expired' ? (
                                                    <Badge variant="secondary" className="bg-green-50 text-green-700 hover:bg-green-100 border-none shadow-sm font-medium">Expired</Badge>
                                                ) : opt.operation === 'Transferred' ? (
                                                    <Badge variant="secondary" className="bg-blue-50 text-blue-700 hover:bg-blue-100 border-none shadow-sm font-medium">Transferred</Badge>
                                                ) : opt.operation === 'Closed' ? (
                                                    <Badge variant="secondary" className="bg-slate-100 text-slate-700 hover:bg-slate-200 border-none shadow-sm font-medium">Closed</Badge>
                                                ) : (
                                                    <Badge variant="outline">{opt.operation}</Badge>
                                                )}
                                            </TableCell>
                                            <TableCell className="py-1">{formatDate(opt.open_date)}</TableCell>
                                            <TableCell className="py-1">{formatDate(opt.settlement_date)}</TableCell>
                                            <TableCell className={`py-1 font-mono font-medium ${opt.quantity > 0 ? 'text-green-700' : 'text-red-700'}`}>
                                                {opt.quantity > 0 ? `+${opt.quantity}` : opt.quantity}
                                            </TableCell>
                                            <TableCell className="py-1 text-[13px] font-medium">{formatOptionTicker(opt)}</TableCell>
                                            <TableCell className="py-1">
                                                {opt.underlying_price != null ? Number(opt.underlying_price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                                            </TableCell>
                                            {settings.showPremium && (
                                                <TableCell className={`py-1 ${opt.premium && opt.premium < 0 ? 'text-red-600' : ''}`}>
                                                    {opt.premium != null ? Math.round(opt.premium).toLocaleString('en-US') : '-'}
                                                </TableCell>
                                            )}
                                            <TableCell className={`py-1 font-medium ${opt.final_profit && opt.final_profit > 0 ? 'text-green-700' : opt.final_profit && opt.final_profit < 0 ? 'text-red-600' : ''}`}>
                                                {opt.final_profit != null ? `${opt.final_profit > 0 ? '+' : ''}${Math.round(opt.final_profit).toLocaleString('en-US')}` : '-'}
                                            </TableCell>
                                            {settings.showTradeCode && (
                                                <TableCell className="py-1 text-xs text-muted-foreground font-mono">{opt.code || '-'}</TableCell>
                                            )}
                                            <TableCell className="py-1 text-xs">
                                                {opt.profit_percent != null && opt.final_profit != null ? (
                                                    <span className={opt.profit_percent > 0 ? 'text-green-700' : opt.profit_percent < 0 ? 'text-red-600' : ''}>
                                                        {opt.profit_percent > 0 ? '+' : ''}{(opt.profit_percent * 100).toFixed(1)}%
                                                    </span>
                                                ) : '-'}
                                            </TableCell>
                                        </TableRow>
                                    );
                                })
                            )}
                        </TableBody>
                    </Table>
                </div>
            </DialogContent>
        </Dialog>
    );
}
