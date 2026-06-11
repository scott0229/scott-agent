import React, { useState, useEffect } from 'react';
import { groupPillClass } from '@/lib/group-colors';
import { getTradingDaysDiff } from '@/lib/holidays';
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
    hideOwnerSuffix = false,
    hideSummary = false,
    showAccountColumn = false,
    isOpenOptionsOnly = false,
    stockTradesContext = [],
}: {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    groupName: string;
    ownerName?: string;
    availableGroups?: {name: string, status: string}[];
    onGroupSelect?: (groupName: string) => void;
    trades: any[];
    hideOwnerSuffix?: boolean;
    hideSummary?: boolean;
    showAccountColumn?: boolean;
    isOpenOptionsOnly?: boolean;
    stockTradesContext?: any[];
}) {
    const { settings } = useAdminSettings();
    const { toast } = useToast();
    const [localTrades, setLocalTrades] = useState<any[]>(trades);
    const [selectedUnderlying, setSelectedUnderlying] = useState<string>('All');

    useEffect(() => {
        setLocalTrades(trades);
    }, [trades]);

    useEffect(() => {
        if (isOpen) {
            setSelectedUnderlying('All');
        }
    }, [isOpen]);

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

    // Sort trades: by owner_name (if shown) then strictly by open_date desc
    const sortedOptions = [...localTrades].sort((a, b) => {
        if (showAccountColumn) {
            const nameA = a.owner_name || '';
            const nameB = b.owner_name || '';
            if (nameA < nameB) return -1;
            if (nameA > nameB) return 1;
        }
        return b.open_date - a.open_date;
    });

    const availableUnderlyings = React.useMemo(() => {
        const set = new Set<string>();
        localTrades.forEach(t => {
            if (t.underlying) set.add(t.underlying);
        });
        return Array.from(set).sort();
    }, [localTrades]);

    const filteredSortedOptions = React.useMemo(() => {
        return sortedOptions.filter(opt => {
            if (selectedUnderlying !== 'All' && opt.underlying !== selectedUnderlying) {
                return false;
            }
            return true;
        });
    }, [sortedOptions, selectedUnderlying]);

    const runningDataMap = React.useMemo(() => {
        const map: Record<number, { total: number; avgPrice: number | null }> = {};
        const stockTrades = stockTradesContext.length > 0 ? stockTradesContext : localTrades.filter(t => t.type === 'STK');
        
        const groupedStocks: Record<string, any[]> = {};
        stockTrades.forEach(t => {
            const key = `${t.owner_id}_${t.underlying}`;
            if (!groupedStocks[key]) groupedStocks[key] = [];
            groupedStocks[key].push(t);
        });

        localTrades.forEach(t => {
            let total = 0;
            let totalCost = 0;
            const key = `${t.owner_id}_${t.underlying}`;
            const underlyingStocks = groupedStocks[key] || [];
            
            underlyingStocks.forEach(l => {
                // If it's a STK trade, it contributes if opened at or before this trade's open_date
                // and hasn't been closed before this trade's open_date
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
        return map;
    }, [localTrades, stockTradesContext]);

    const totalNetCashInflow = filteredSortedOptions
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

    // Mark-to-market cost to close every open leg. Mirrors the trade-groups
    // page setting: when closeCostOnlyBreached is on, OTM legs contribute
    // 0 (no realistic buyback cost) and only ITM legs roll up here.
    const totalOpenCostToClose = filteredSortedOptions
        .filter(opt => opt.type !== 'STK' && (opt.operation === 'Open' || !opt.settlement_date))
        .filter(opt => {
            if (!settings.closeCostOnlyBreached) return true;
            const spot = (opt as { current_market_price?: number | null }).current_market_price;
            const strike = opt.strike_price;
            if (spot == null || strike == null) return true; // fall back to including when we can't decide
            if (opt.type === 'CALL') return spot > strike;
            if (opt.type === 'PUT') return spot < strike;
            return true;
        })
        .reduce((sum, opt) => sum + ((opt.premium || 0) - (opt.final_profit || 0)), 0);

    const formattedOpenCost = totalOpenCostToClose > 0 
        ? `-${totalOpenCostToClose.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}` 
        : (totalOpenCostToClose === 0 ? "0" : `+${Math.abs(totalOpenCostToClose).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}`);

    const totalStockPnL = filteredSortedOptions
        .filter(opt => opt.type === 'STK')
        .reduce((sum, opt) => sum + (opt.final_profit ? opt.final_profit : 0), 0);

    const formattedStockPnL = totalStockPnL > 0
        ? `+${totalStockPnL.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}`
        : (totalStockPnL === 0 ? "0" : totalStockPnL.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 }));

    // 總損益 is the identity of the boxes the header shows:
    //   總現金流入 − 平倉成本 + 持股獲利
    // Derived (not a raw final_profit sum) so it stays consistent when
    // 平倉成本 is suppressed by the 只計入被突破 setting — otherwise the
    // equation visibly failed (e.g. -18.5 + 0 displayed as -1,209).
    const totalPnL = totalNetCashInflow - totalOpenCostToClose + totalStockPnL;
    const formattedPnL = totalPnL > 0 ? `+${Math.round(totalPnL).toLocaleString('en-US')}` : (totalPnL < 0 ? Math.round(totalPnL).toLocaleString('en-US') : '');

    const rollProfitsMap = new Map<number, number>();
    // 展期天數 — trading days between the rolled-from expiry and the new
    // expiry, keyed by the open's id (same key space as rollProfitsMap).
    const rollDaysMap = new Map<number, number>();

    // Sequential roll pairing: each open consumes the most recent unconsumed close
    // of the same underlying+type with matching quantity. This matches the user's
    // mental model — "this open replaced that close" — rather than the previous
    // same-day batch averaging, which was hard to interpret when a position was
    // both opened and closed on the same day.
    type CloseEvent = {
        id: number;
        settlement_date: number;
        open_date: number;
        to_date: number | null;
        key: string;
        cost: number;
        qty: number;
        consumed: boolean;
    };
    const closeEvents: CloseEvent[] = [];

    sortedOptions.forEach(t => {
        if (t.type === 'STK') return;
        if (t.settlement_date && t.premium != null && t.final_profit != null) {
            closeEvents.push({
                id: t.id,
                settlement_date: t.settlement_date,
                open_date: t.open_date,
                to_date: t.to_date ?? null,
                key: `${t.underlying}_${t.type}`,
                cost: t.premium - t.final_profit,
                qty: t.quantity,
                consumed: false,
            });
        }
    });

    // Trading days from a rolled-from close to the new open's expiry. Both
    // legs carry to_date; abs() so it always reads as a positive duration.
    const rollDaysBetween = (closeToDate: number | null | undefined, openToDate: number | null | undefined): number | null => {
        if (closeToDate == null || openToDate == null) return null;
        return Math.abs(getTradingDaysDiff(closeToDate, openToDate));
    };

    // Sort closes by settlement_date asc, then by open_date asc so that on a tied
    // close date the position with the older lifecycle is consumed first (FIFO).
    closeEvents.sort((a, b) => a.settlement_date - b.settlement_date || a.open_date - b.open_date);

    // Iterate opens in chronological order so earlier opens claim earlier closes.
    const openEvents = sortedOptions
        .filter(t => t.type !== 'STK' && t.premium != null)
        .slice()
        .sort((a, b) => a.open_date - b.open_date || (a.settlement_date ?? Infinity) - (b.settlement_date ?? Infinity));

    // Pass 0 — same-day balanced group rolls. When the closes and opens of a
    // given key all happen on the same day and the quantities balance, pair
    // the whole group together BEFORE Pass 1's greedy 1-to-1 has a chance to
    // claim pieces of it from elsewhere. Common case: close -3 splits same-day
    // into open -1 + open -2 — without this pass the open -1 leg could get
    // greedily matched to some unrelated earlier -1 close, leaving the open
    // -2 leg unmatched in Pass 3 (because 2 alone can't fulfill the -3 close).
    //
    // We bucket by start-of-day epoch so closes whose settlement_date is
    // stored at end-of-day still bucket with opens at start-of-day on the
    // same calendar date.
    const dayOf = (epochSec: number) => Math.floor(epochSec / 86400) * 86400;
    type OpenEvent = (typeof openEvents)[number];
    type SameDayBucket = { closes: CloseEvent[]; opens: OpenEvent[] };
    const sameDayBuckets = new Map<string, SameDayBucket>();

    for (const ce of closeEvents) {
        const dayKey = `${dayOf(ce.settlement_date)}_${ce.key}`;
        if (!sameDayBuckets.has(dayKey)) sameDayBuckets.set(dayKey, { closes: [], opens: [] });
        sameDayBuckets.get(dayKey)!.closes.push(ce);
    }
    for (const ot of openEvents) {
        const dayKey = `${dayOf(ot.open_date)}_${ot.underlying}_${ot.type}`;
        const bucket = sameDayBuckets.get(dayKey);
        if (bucket) bucket.opens.push(ot);
    }

    for (const bucket of sameDayBuckets.values()) {
        const { closes, opens } = bucket;
        if (closes.length === 0 || opens.length === 0) continue;
        if (closes.length === 1 && opens.length === 1) continue; // let Pass 1 handle
        // Filter out the rare self-pair case (a trade appearing as both close
        // and open via shared id).
        const closeIds = new Set(closes.map(c => c.id));
        const validOpens = opens.filter(o => !closeIds.has(o.id));
        if (validOpens.length === 0) continue;

        const closeQty = closes.reduce((s, ce) => s + ce.qty, 0);
        const openQty = validOpens.reduce((s, ot) => s + ot.quantity, 0);
        if (closeQty !== openQty) continue;

        // Distribute total close cost across the opens proportionally by qty
        // so each open's 展期收益 reflects its share of the rolled position.
        const totalCost = closes.reduce((s, ce) => s + ce.cost, 0);
        // Representative close for the day-count — they share a settlement day,
        // so any close's to_date gives the same rolled-from expiry.
        const repToDate = closes[0]?.to_date ?? null;
        for (const ot of validOpens) {
            const proRatedCost = totalCost * (ot.quantity / openQty);
            rollProfitsMap.set(ot.id, (ot.premium as number) - proRatedCost);
            const days = rollDaysBetween(repToDate, ot.to_date);
            if (days != null) rollDaysMap.set(ot.id, days);
        }
        closes.forEach(ce => { ce.consumed = true; });
    }

    openEvents.forEach(ot => {
        // Already matched by Pass 0 (same-day balanced group) — skip.
        if (rollProfitsMap.has(ot.id)) return;

        const key = `${ot.underlying}_${ot.type}`;

        // Pass 1 — 1-to-1: walk backwards, take the most recent eligible close
        // with the exact same quantity. Covers the common simple roll case.
        let matched = false;
        for (let i = closeEvents.length - 1; i >= 0; i--) {
            const ce = closeEvents[i];
            if (ce.consumed) continue;
            if (ce.id === ot.id) continue; // never pair a trade with itself
            if (ce.key !== key) continue;
            if (ce.settlement_date > ot.open_date) continue; // close must happen on/before the open
            if (ce.qty !== ot.quantity) continue;
            rollProfitsMap.set(ot.id, (ot.premium as number) - ce.cost);
            const days = rollDaysBetween(ce.to_date, ot.to_date);
            if (days != null) rollDaysMap.set(ot.id, days);
            ce.consumed = true;
            matched = true;
            break;
        }

        // Pass 2 — N-to-1 merge: when no single close matches the open's qty,
        // try to find a subset of unconsumed same-key closes (within the open's
        // own settlement date window) whose quantities sum to the open's qty.
        // Common case: closed -6 + closed -3 → opened -9.
        // Bound the search space by limiting to closes within a 7-day window
        // before/on the open date — merges almost always happen same-day.
        if (!matched) {
            const WINDOW_DAYS = 7;
            const earliestAllowed = ot.open_date - WINDOW_DAYS * 86400;
            const candidates = closeEvents.filter(ce =>
                !ce.consumed &&
                ce.id !== ot.id &&
                ce.key === key &&
                ce.settlement_date <= ot.open_date &&
                ce.settlement_date >= earliestAllowed
            );
            // Bitwise subset enumeration is fine for small candidate pools.
            // Cap at 12 to keep the worst case at 4096 iterations per open.
            if (candidates.length > 0 && candidates.length <= 12) {
                const target = ot.quantity;
                let bestSubset: CloseEvent[] | null = null;
                for (let mask = 1; mask < (1 << candidates.length); mask++) {
                    let sum = 0;
                    const subset: CloseEvent[] = [];
                    for (let j = 0; j < candidates.length; j++) {
                        if (mask & (1 << j)) {
                            subset.push(candidates[j]);
                            sum += candidates[j].qty;
                        }
                    }
                    if (sum === target) {
                        // Prefer the smallest subset (fewest closes merged into
                        // this open) — that's almost always the intended pairing.
                        if (!bestSubset || subset.length < bestSubset.length) {
                            bestSubset = subset;
                        }
                    }
                }
                if (bestSubset) {
                    const totalCost = bestSubset.reduce((s, ce) => s + ce.cost, 0);
                    rollProfitsMap.set(ot.id, (ot.premium as number) - totalCost);
                    const days = rollDaysBetween(bestSubset[0]?.to_date ?? null, ot.to_date);
                    if (days != null) rollDaysMap.set(ot.id, days);
                    bestSubset.forEach(ce => { ce.consumed = true; });
                }
            }
        }
    });

    // Pass 3 — 1-to-N split: an unconsumed close that fed multiple smaller
    // opens. Common case: closed -14 → opened -2 + opened -12 the same day.
    // Find a subset of still-unmatched same-key opens (within the close's own
    // settlement-date window) whose quantities sum to the close's qty, and
    // split the close's cost proportionally across them. Pro-rated by qty
    // because cost-per-contract is the natural unit — splitting on premium
    // would skew the gain on whichever leg happened to roll at a higher
    // strike.
    closeEvents.forEach(ce => {
        if (ce.consumed) return;

        const WINDOW_DAYS = 7;
        const latestAllowed = ce.settlement_date + WINDOW_DAYS * 86400;
        const candidates = openEvents.filter(ot =>
            !rollProfitsMap.has(ot.id) &&
            ot.id !== ce.id &&
            `${ot.underlying}_${ot.type}` === ce.key &&
            ot.open_date >= ce.settlement_date &&
            ot.open_date <= latestAllowed
        );

        if (candidates.length === 0 || candidates.length > 12) return;

        const target = ce.qty;
        let bestSubset: typeof candidates | null = null;
        for (let mask = 1; mask < (1 << candidates.length); mask++) {
            let sum = 0;
            const subset: typeof candidates = [];
            for (let j = 0; j < candidates.length; j++) {
                if (mask & (1 << j)) {
                    subset.push(candidates[j]);
                    sum += candidates[j].quantity;
                }
            }
            if (sum === target) {
                if (!bestSubset || subset.length < bestSubset.length) {
                    bestSubset = subset;
                }
            }
        }

        if (bestSubset) {
            const totalQty = bestSubset.reduce((s, ot) => s + ot.quantity, 0);
            bestSubset.forEach(ot => {
                const proRatedCost = ce.cost * (ot.quantity / totalQty);
                rollProfitsMap.set(ot.id, (ot.premium as number) - proRatedCost);
                const days = rollDaysBetween(ce.to_date, ot.to_date);
                if (days != null) rollDaysMap.set(ot.id, days);
            });
            ce.consumed = true;
        }
    });

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className={`max-h-[85vh] flex flex-col ${isOpenOptionsOnly ? 'sm:max-w-[1150px]' : 'sm:max-w-[1550px]'}`} onOpenAutoFocus={(e) => e.preventDefault()}>
                <DialogHeader className="shrink-0">
                    <DialogTitle className="flex items-center gap-2 text-2xl font-bold">
                        <span>{ownerName ? (hideOwnerSuffix ? ownerName : `${ownerName} 群組`) : '群組交易明細'}</span>
                        {availableGroups && availableGroups.length > 0 && onGroupSelect ? (
                            <Select value={groupName} onValueChange={onGroupSelect}>
                                <SelectTrigger className="w-auto h-8 text-base font-semibold border-none shadow-none focus:ring-0 px-2 bg-muted hover:bg-muted/80 transition-colors">
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
                        {availableUnderlyings.length > 1 && (
                            <Select value={selectedUnderlying} onValueChange={setSelectedUnderlying}>
                                <SelectTrigger className="w-[120px] h-8 text-[14px] font-normal border-none shadow-none bg-muted hover:bg-muted/80 focus:ring-0 ml-2">
                                    <SelectValue placeholder="標的篩選" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="All">全部標的</SelectItem>
                                    {availableUnderlyings.map(sym => (
                                        <SelectItem key={sym} value={sym}>
                                            {sym}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                        {!hideSummary && filteredSortedOptions.length > 0 && (
                            <div className="flex flex-wrap items-center gap-2 ml-2 text-base font-normal">
                                {filteredSortedOptions.some(opt => opt.type !== 'STK') && (
                                    <>
                                        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-card border border-slate-200 rounded-md shadow-sm text-[14px] font-normal">
                                            <span className="text-foreground">總現金流入</span>
                                            <span className={totalNetCashInflow > 0 ? 'text-status-positive' : 'text-status-negative'}>{formattedNetCash}</span>
                                        </div>
                                        <span className="text-muted-foreground font-medium">+</span>
                                        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-card border border-slate-200 rounded-md shadow-sm text-[14px] font-normal">
                                            <span className="text-foreground">平倉成本</span>
                                            <span className={totalOpenCostToClose > 0 ? 'text-status-negative' : 'text-status-positive'}>{formattedOpenCost}</span>
                                        </div>
                                    </>
                                )}
                                {filteredSortedOptions.some(opt => opt.type === 'STK') && (
                                    <>
                                        {filteredSortedOptions.some(opt => opt.type !== 'STK') && <span className="text-muted-foreground font-medium">+</span>}
                                        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-card border border-slate-200 rounded-md shadow-sm text-[14px] font-normal">
                                            <span className="text-foreground">持股獲利</span>
                                            <span className={totalStockPnL > 0 ? 'text-status-positive' : totalStockPnL < 0 ? 'text-status-negative' : ''}>{formattedStockPnL}</span>
                                        </div>
                                    </>
                                )}
                                <span className="text-muted-foreground font-medium">=</span>
                                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-card border border-slate-200 rounded-md shadow-sm text-[14px] font-normal">
                                    <span className="text-foreground">總損益</span>
                                    <span className={totalPnL > 0 ? 'text-status-positive' : 'text-status-negative'}>{formattedPnL}</span>
                                </div>
                            </div>
                        )}
                    </DialogTitle>
                </DialogHeader>
                
                <div className="bg-card rounded-lg shadow-sm border overflow-auto mt-3 flex-1 min-h-0">
                    <Table className="whitespace-nowrap relative">
                        <TableHeader className="sticky top-0 z-10 bg-table-header-bg shadow-sm">
                            <TableRow>
                                <TableHead className="text-center w-[60px] px-2"></TableHead>
                                <TableHead className="text-left min-w-[200px] max-w-[300px]"></TableHead>
                                {showAccountColumn && <TableHead className="text-center w-[90px]">帳戶</TableHead>}
                                <TableHead className="text-center w-[110px]">群組</TableHead>
                                {!isOpenOptionsOnly && <TableHead className="text-center">操作</TableHead>}
                                <TableHead className="text-center">開倉日</TableHead>
                                {!isOpenOptionsOnly && <TableHead className="text-center">平倉日</TableHead>}
                                <TableHead className="text-center">數量</TableHead>
                                <TableHead className="text-center">標的</TableHead>
                                <TableHead className="text-center">DTE</TableHead>
                                <TableHead className="text-center">累積持股</TableHead>
                                {!isOpenOptionsOnly && <TableHead className="text-center">當時股價</TableHead>}
                                {settings.showPremium && !isOpenOptionsOnly && <TableHead className="text-center">權利金</TableHead>}
                                <TableHead className="text-center">損益</TableHead>
                                {!isOpenOptionsOnly && <TableHead className="text-center">展期天數</TableHead>}
                                {!isOpenOptionsOnly && <TableHead className="text-center">展期收益</TableHead>}
                                {settings.showTradeCode && <TableHead className="text-center">交易代碼</TableHead>}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredSortedOptions.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={15} className="text-center py-8 text-muted-foreground">
                                        尚無交易
                                    </TableCell>
                                </TableRow>
                            ) : (
                                filteredSortedOptions.map((opt, index) => {
                                    const rollProfit = rollProfitsMap.has(opt.id) ? rollProfitsMap.get(opt.id) : null;
                                    const rollDays = rollDaysMap.has(opt.id) ? rollDaysMap.get(opt.id) : null;

                                    return (
                                        <TableRow
                                            key={opt.id}
                                            className={`text-center transition-colors h-[40px] ${opt.type === 'STK' ? 'cell-negative' : 'hover:bg-muted/50'} ${opt.has_separator ? `border-t-4 ${SEPARATOR_COLORS[typeof opt.has_separator === 'number' ? opt.has_separator : 1] || 'border-orange-200'}` : ''}`}
                                        >
                                            <TableCell className="py-1 w-[60px] px-2">
                                                <div className="flex items-center justify-end gap-3 pr-2">
                                                    <span className="text-muted-foreground">{filteredSortedOptions.length - index}</span>
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
                                                    style={{ color: opt.note_color === 'red' ? 'var(--note-red)' : opt.note_color === 'green' ? 'var(--note-green)' : 'var(--note-blue)' }}
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
                                            {showAccountColumn && (
                                                <TableCell className="py-1 text-center text-xs font-medium text-muted-foreground">
                                                    <span className="bg-primary/10 text-foreground px-2 py-0.5 rounded">
                                                        {opt.owner_name || '-'}
                                                    </span>
                                                </TableCell>
                                            )}
                                            <TableCell className="py-1 min-w-[110px]">
                                                <div className={`w-[80px] mx-auto h-7 flex items-center justify-center rounded-md font-normal text-[13px] ${groupPillClass(opt.group_id) || 'bg-muted'}`}>
                                                    {opt.group_id || '-'}
                                                </div>
                                            </TableCell>
                                            {!isOpenOptionsOnly && (
                                                <TableCell className="py-1 min-w-[100px]">
                                                    {opt.operation === 'Open' || !opt.operation ? (
                                                        <Badge variant="secondary" className="cell-note hover:bg-note-badge border-none shadow-sm font-medium">Open</Badge>
                                                    ) : opt.operation === 'Assigned' ? (
                                                        <Badge variant="destructive" className="cell-negative hover:bg-status-negative-soft border-none shadow-sm font-medium">Assigned</Badge>
                                                    ) : opt.operation === 'Expired' ? (
                                                        <Badge variant="secondary" className="cell-positive hover:bg-status-positive-soft border-none shadow-sm font-medium">Expired</Badge>
                                                    ) : opt.operation === 'Transferred' ? (
                                                        <Badge variant="secondary" className="bg-note-blue/20 text-note-blue hover:bg-note-blue/20 border-none shadow-sm font-medium">Transferred</Badge>
                                                    ) : opt.operation === 'Closed' ? (
                                                        <Badge variant="secondary" className="bg-secondary text-secondary-foreground hover:bg-secondary border-none shadow-sm font-medium">Closed</Badge>
                                                    ) : (
                                                        <Badge variant="outline">{opt.operation}</Badge>
                                                    )}
                                                </TableCell>
                                            )}
                                            <TableCell className="py-1">
                                                <span className="inline-flex items-center gap-1.5">
                                                    {formatDate(opt.open_date)}
                                                    {/* "被派" pill flags stock rows that came in via PUT assignment
                                                        (source = 'assigned'). Makes the "why is there a stock trade
                                                        in this group" obvious without opening the linked option. */}
                                                    {opt.type === 'STK' && opt.source?.toLowerCase?.() === 'assigned' && (
                                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-status-positive-soft text-status-positive font-medium leading-none whitespace-nowrap">被派</span>
                                                    )}
                                                </span>
                                            </TableCell>
                                            {!isOpenOptionsOnly && (
                                                <TableCell className="py-1">
                                                    {(opt.operation === 'Open' || !opt.settlement_date) ? "-" : (
                                                        <span className="inline-flex items-center gap-1.5">
                                                            {formatDate(opt.settlement_date)}
                                                            {/* Stock close via CALL assignment — mirror the open-side flag.
                                                                Same green styling as the open-side pill so the user reads
                                                                "this was an assignment" without parsing two color schemes. */}
                                                            {opt.type === 'STK' && opt.close_source?.toLowerCase?.() === 'assigned' && (
                                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-status-positive-soft text-status-positive font-medium leading-none whitespace-nowrap">被派</span>
                                                            )}
                                                        </span>
                                                    )}
                                                </TableCell>
                                            )}
                                            <TableCell className="py-1 font-mono text-foreground">
                                                {opt.quantity > 0 ? `+${opt.quantity}` : opt.quantity}
                                            </TableCell>
                                            <TableCell className="py-1">{formatOptionTicker(opt)}</TableCell>
                                            <TableCell className="py-1 text-center text-muted-foreground">
                                                {(() => {
                                                    // DTE = trading days from open_date to expiry (to_date),
                                                    // i.e. weekends + market holidays excluded. Options only;
                                                    // stocks have no expiry.
                                                    if (opt.type === 'STK' || !opt.open_date || !opt.to_date) return opt.type === 'STK' ? '' : '-';
                                                    const days = Math.abs(getTradingDaysDiff(opt.open_date, opt.to_date));
                                                    return `${days} 天`;
                                                })()}
                                            </TableCell>
                                            <TableCell className="py-1 text-center whitespace-nowrap">
                                                {runningDataMap[opt.id]?.total > 0 ? (
                                                    <div className="flex items-center justify-center gap-1">
                                                        <span className="text-foreground">{runningDataMap[opt.id].total.toLocaleString()},</span>
                                                        <span className="text-foreground underline underline-offset-2">均{runningDataMap[opt.id].avgPrice?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                    </div>
                                                ) : '-'}
                                            </TableCell>
                                            {!isOpenOptionsOnly && (
                                                <TableCell className="py-1">
                                                    {opt.underlying_price != null ? Number(opt.underlying_price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                                                </TableCell>
                                            )}
                                            {settings.showPremium && !isOpenOptionsOnly && (
                                                <TableCell className="py-1 text-center">
                                                    {opt.premium != null ? opt.premium.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 }) : '-'}
                                                </TableCell>
                                            )}
                                            <TableCell className={`py-1 ${opt.final_profit && opt.final_profit > 0 ? 'text-status-positive' : opt.final_profit && opt.final_profit < 0 ? 'text-status-negative' : ''}`}>
                                                {opt.final_profit != null ? `${opt.final_profit > 0 ? '+' : ''}${Math.round(opt.final_profit).toLocaleString('en-US')}` : '-'}
                                            </TableCell>
                                            {!isOpenOptionsOnly && (
                                                <TableCell className="py-1 text-center text-muted-foreground">
                                                    {rollDays != null ? `${rollDays} 天` : (opt.type === 'STK' ? '' : '-')}
                                                </TableCell>
                                            )}
                                            {!isOpenOptionsOnly && (
                                                <TableCell className={`py-1 text-center ${rollProfit && rollProfit > 0 ? 'text-status-positive' : rollProfit && rollProfit < 0 ? 'text-status-negative' : ''}`}>
                                                    {rollProfit != null ? `${rollProfit > 0 ? '+' : ''}${rollProfit.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}` : (opt.type === 'STK' ? '' : '-')}
                                                </TableCell>
                                            )}
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
