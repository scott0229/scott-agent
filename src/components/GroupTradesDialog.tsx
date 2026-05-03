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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
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
    if (!opt.to_date) return <>{underlying} - <span className="underline underline-offset-2">{strike}{typeChar}</span></>;
    const d = new Date(opt.to_date * 1000);
    const mon = MONTH_ABBR[d.getMonth()];
    const day = d.getDate();
    const yr = d.getFullYear().toString().slice(-2);
    return <>{underlying} {mon}{day}'{yr} <span className="underline underline-offset-2">{strike}{typeChar}</span></>;
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
    availableGroups = [],
    onGroupSelect,
    trades,
}: {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    groupName: string;
    ownerName?: string;
    availableGroups?: {name: string, status: string}[];
    onGroupSelect?: (groupName: string) => void;
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

    const runningDataMap = React.useMemo(() => {
        const map: Record<number, { total: number; avgPrice: number | null }> = {};
        const stockTrades = localTrades.filter(t => t.type === 'STK');
        
        const grouped: Record<string, any[]> = {};
        stockTrades.forEach(t => {
            const key = t.underlying;
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(t);
        });

        Object.values(grouped).forEach(group => {
            group.forEach(t => {
                let total = 0;
                let totalCost = 0;
                group.forEach(l => {
                    if (l.open_date <= t.open_date) {
                        if (!l.settlement_date || l.settlement_date > t.open_date) {
                            total += l.quantity;
                            totalCost += l.quantity * l.underlying_price;
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
    }, [localTrades]);

    const totalPnL = sortedOptions.reduce((sum, opt) => sum + (opt.final_profit ? opt.final_profit : 0), 0);
    const formattedPnL = totalPnL > 0 ? `+${Math.round(totalPnL).toLocaleString('en-US')}` : (totalPnL < 0 ? Math.round(totalPnL).toLocaleString('en-US') : '');

    const totalNetCashInflow = sortedOptions
        .filter(opt => opt.type !== 'STK')
        .reduce((sum, opt) => {
            if (opt.operation === 'Open' || !opt.settlement_date) {
                return sum + (opt.premium || 0);
            } else {
                return sum + (opt.final_profit || 0);
            }
        }, 0);
    
    const formattedNetCash = totalNetCashInflow > 0 
        ? `+${totalNetCashInflow.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}` 
        : (totalNetCashInflow < 0 ? totalNetCashInflow.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 }) : '0');

    const totalOpenCostToClose = sortedOptions
        .filter(opt => opt.type !== 'STK' && (opt.operation === 'Open' || !opt.settlement_date))
        .reduce((sum, opt) => sum + ((opt.premium || 0) - (opt.final_profit || 0)), 0);

    const formattedOpenCost = totalOpenCostToClose > 0 
        ? `+${totalOpenCostToClose.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}` 
        : (totalOpenCostToClose === 0 ? "0" : totalOpenCostToClose.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 }));

    const rollProfitsMap = new Map<number, number>();
    
    // Group trades by Date + Underlying + Type for batch roll detection (handles 1-to-1, 1-to-N, N-to-M splits)
    const dateGroups = new Map<string, { closedTrades: typeof sortedOptions, openedTrades: typeof sortedOptions }>();
    
    sortedOptions.forEach(t => {
        if (t.type === 'STK') return;
        
        // Record as opened trade
        const openDateStr = formatDate(t.open_date);
        const keyOpen = `${openDateStr}_${t.underlying}_${t.type}`;
        if (!dateGroups.has(keyOpen)) {
            dateGroups.set(keyOpen, { closedTrades: [], openedTrades: [] });
        }
        dateGroups.get(keyOpen)!.openedTrades.push(t);
        
        // Record as closed trade
        if (t.settlement_date) {
            const closeDateStr = formatDate(t.settlement_date);
            const keyClose = `${closeDateStr}_${t.underlying}_${t.type}`;
            if (!dateGroups.has(keyClose)) {
                dateGroups.set(keyClose, { closedTrades: [], openedTrades: [] });
            }
            dateGroups.get(keyClose)!.closedTrades.push(t);
        }
    });

    dateGroups.forEach(group => {
        if (group.closedTrades.length > 0 && group.openedTrades.length > 0) {
            let matchedC = group.closedTrades;
            let matchedO = group.openedTrades;
            
            const sumC = matchedC.reduce((sum, t) => sum + t.quantity, 0);
            const sumO = matchedO.reduce((sum, t) => sum + t.quantity, 0);
            
            let isMatch = false;
            
            if (sumC === sumO && sumC !== 0) {
                isMatch = true;
            } else if (matchedC.length <= 10 && matchedO.length <= 10) {
                // Try subset matching for complex splits/merges
                const getSubsets = (arr: typeof sortedOptions) => {
                    const subsets: (typeof sortedOptions)[] = [];
                    const n = arr.length;
                    for (let i = 1; i < (1 << n); i++) {
                        const subset = [];
                        for (let j = 0; j < n; j++) {
                            if ((i & (1 << j))) subset.push(arr[j]);
                        }
                        subsets.push(subset);
                    }
                    return subsets;
                };
                
                const subsetsC = getSubsets(matchedC);
                const subsetsO = getSubsets(matchedO);
                
                let found = false;
                // Prefer matching ALL closed trades to a subset of open trades
                for (const subO of subsetsO) {
                    if (subO.reduce((s, t) => s + t.quantity, 0) === sumC && sumC !== 0) {
                        matchedO = subO;
                        isMatch = true;
                        found = true;
                        break;
                    }
                }
                
                // Prefer matching ALL open trades to a subset of closed trades
                if (!found) {
                    for (const subC of subsetsC) {
                        if (subC.reduce((s, t) => s + t.quantity, 0) === sumO && sumO !== 0) {
                            matchedC = subC;
                            isMatch = true;
                            found = true;
                            break;
                        }
                    }
                }
                
                // Find largest partial match
                if (!found) {
                    let bestMatch: { c: typeof sortedOptions, o: typeof sortedOptions, qty: number } | null = null;
                    for (const subC of subsetsC) {
                        const sC = subC.reduce((s, t) => s + t.quantity, 0);
                        if (sC === 0) continue;
                        for (const subO of subsetsO) {
                            const sO = subO.reduce((s, t) => s + t.quantity, 0);
                            if (sC === sO) {
                                if (!bestMatch || Math.abs(sC) > Math.abs(bestMatch.qty)) {
                                    bestMatch = { c: subC, o: subO, qty: sC };
                                }
                            }
                        }
                    }
                    if (bestMatch) {
                        matchedC = bestMatch.c;
                        matchedO = bestMatch.o;
                        isMatch = true;
                    }
                }
            }

            const isSelfMatch = (cArr: typeof sortedOptions, oArr: typeof sortedOptions) => {
                if (cArr.length === 0 || oArr.length === 0) return false;
                return cArr.every(c => oArr.some(o => o.id === c.id)) && oArr.every(o => cArr.some(c => c.id === o.id));
            };

            if (isMatch && !isSelfMatch(matchedC, matchedO)) {
                let totalCostToClose = 0;
                let canCalculate = true;
                
                for (const ct of matchedC) {
                    if (ct.premium == null || ct.final_profit == null) {
                        canCalculate = false;
                        break;
                    }
                    totalCostToClose += (ct.premium - ct.final_profit);
                }
                
                if (canCalculate) {
                    const finalSumO = matchedO.reduce((sum, t) => sum + t.quantity, 0);
                    for (const ot of matchedO) {
                        if (ot.premium != null) {
                            const proportion = ot.quantity / finalSumO;
                            const allocatedCost = totalCostToClose * proportion;
                            rollProfitsMap.set(ot.id, ot.premium - allocatedCost);
                        }
                    }
                }
            }
        }
    });

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[1400px] max-h-[85vh] overflow-y-auto" onOpenAutoFocus={(e) => e.preventDefault()}>
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <span>{ownerName ? `${ownerName} 群組` : '群組交易明細'}</span>
                        {availableGroups && availableGroups.length > 0 && onGroupSelect ? (
                            <Select value={groupName} onValueChange={onGroupSelect}>
                                <SelectTrigger className="w-auto h-8 text-base font-semibold border-none shadow-none focus:ring-0 px-2 bg-slate-100 hover:bg-slate-200 transition-colors">
                                    <SelectValue placeholder={groupName} />
                                </SelectTrigger>
                                <SelectContent>
                                    {availableGroups.map(g => (
                                        <SelectItem key={g.name} value={g.name}>
                                            {g.name}{g.status === 'Terminated' ? ' (已終止)' : ''}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        ) : (
                            <span>{groupName}</span>
                        )}
                    </DialogTitle>
                </DialogHeader>
                
                {sortedOptions.some(opt => opt.type !== 'STK') && (
                    <div className="flex flex-wrap items-center gap-3 mt-3 px-1">
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-md shadow-sm text-[15px] font-medium">
                            <span className="text-foreground">總現金流入</span>
                            <span className={totalNetCashInflow > 0 ? 'text-green-700' : 'text-red-600'}>{formattedNetCash}</span>
                        </div>
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-md shadow-sm text-[15px] font-medium">
                            <span className="text-foreground">平倉成本</span>
                            <span className={totalOpenCostToClose > 0 ? 'text-red-600' : 'text-green-700'}>{formattedOpenCost}</span>
                        </div>
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-md shadow-sm text-[15px] font-medium">
                            <span className="text-foreground">總損益</span>
                            <span className={totalPnL > 0 ? 'text-green-700' : 'text-red-600'}>{formattedPnL}</span>
                        </div>
                    </div>
                )}
                
                <div className="bg-white rounded-lg shadow-sm border overflow-x-auto mt-3">
                    <Table className="whitespace-nowrap">
                        <TableHeader>
                            <TableRow className="bg-secondary hover:bg-secondary">
                                <TableHead className="text-center w-[60px] px-2"></TableHead>
                                <TableHead className="text-left min-w-[200px] max-w-[300px]"></TableHead>
                                <TableHead className="text-center w-[110px]"></TableHead>
                                <TableHead className="text-center">操作</TableHead>
                                <TableHead className="text-center">開倉日</TableHead>
                                <TableHead className="text-center">平倉日</TableHead>
                                <TableHead className="text-center">數量</TableHead>
                                <TableHead className="text-center">標的</TableHead>
                                <TableHead className="text-center">累積持股</TableHead>
                                <TableHead className="text-center">當時股價</TableHead>
                                {settings.showPremium && <TableHead className="text-center">權利金</TableHead>}
                                <TableHead className="text-center">損益</TableHead>
                                <TableHead className="text-center">展期收益</TableHead>
                                {settings.showTradeCode && <TableHead className="text-center">交易代碼</TableHead>}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {sortedOptions.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={15} className="text-center py-8 text-muted-foreground">
                                        尚無交易
                                    </TableCell>
                                </TableRow>
                            ) : (
                                sortedOptions.map((opt, index) => {
                                    const rollProfit = rollProfitsMap.has(opt.id) ? rollProfitsMap.get(opt.id) : null;

                                    return (
                                        <TableRow
                                            key={opt.id}
                                            className={`text-center transition-colors h-[40px] ${opt.type === 'STK' ? 'bg-pink-50' : 'hover:bg-muted/50'} ${opt.has_separator ? `border-t-4 ${SEPARATOR_COLORS[typeof opt.has_separator === 'number' ? opt.has_separator : 1] || 'border-orange-200'}` : ''}`}
                                        >
                                            <TableCell className="py-1 w-[60px] px-2">
                                                <div className="flex items-center justify-end gap-3 pr-2">
                                                    <span className="text-muted-foreground">{sortedOptions.length - index}</span>
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
                                            <TableCell className="py-1 min-w-[200px] max-w-[300px]">
                                                <input 
                                                    type="text"
                                                    className="w-full bg-transparent border-none focus:ring-0 focus:outline-none px-1 text-left text-[13px] font-medium truncate"
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
                                                    <Badge variant="secondary" className="bg-yellow-50 text-slate-700 hover:bg-yellow-100 border-none shadow-sm font-medium">Open</Badge>
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
                                            <TableCell className="py-1">
                                                {(opt.operation === 'Open' || !opt.settlement_date) ? "-" : formatDate(opt.settlement_date)}
                                            </TableCell>
                                            <TableCell className="py-1 font-mono text-foreground">
                                                {opt.quantity > 0 ? `+${opt.quantity}` : opt.quantity}
                                            </TableCell>
                                            <TableCell className="py-1">{formatOptionTicker(opt)}</TableCell>
                                            <TableCell className="py-1 text-center whitespace-nowrap">
                                                {opt.type === 'STK' ? (
                                                    runningDataMap[opt.id]?.total > 0 ? (
                                                        <div className="flex items-center justify-center gap-1">
                                                            <span>股{runningDataMap[opt.id].total.toLocaleString()},</span>
                                                            <span className="text-[13px] text-foreground">均{runningDataMap[opt.id].avgPrice?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                        </div>
                                                    ) : '-'
                                                ) : ''}
                                            </TableCell>
                                            <TableCell className="py-1">
                                                {opt.underlying_price != null ? Number(opt.underlying_price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                                            </TableCell>
                                            {settings.showPremium && (
                                                <TableCell className="py-1 text-center">
                                                    {opt.premium != null ? opt.premium.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 }) : '-'}
                                                </TableCell>
                                            )}
                                            <TableCell className={`py-1 ${opt.final_profit && opt.final_profit > 0 ? 'text-green-700' : opt.final_profit && opt.final_profit < 0 ? 'text-red-600' : ''}`}>
                                                {opt.final_profit != null ? `${opt.final_profit > 0 ? '+' : ''}${Math.round(opt.final_profit).toLocaleString('en-US')}` : '-'}
                                            </TableCell>
                                            <TableCell className={`py-1 text-center ${rollProfit && rollProfit > 0 ? 'text-green-700' : rollProfit && rollProfit < 0 ? 'text-red-600' : ''}`}>
                                                {rollProfit != null ? `${rollProfit > 0 ? '+' : ''}${rollProfit.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}` : (opt.type === 'STK' ? '' : '-')}
                                            </TableCell>
                                            {settings.showTradeCode && (
                                                <TableCell className="py-1 text-xs text-muted-foreground font-mono">{opt.code || '-'}</TableCell>
                                            )}
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
