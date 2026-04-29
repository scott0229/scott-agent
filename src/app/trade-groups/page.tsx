'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useYearFilter } from '@/contexts/YearFilterContext';
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Loader2, FilterX } from "lucide-react";
import { GroupTradesDialog } from "@/components/GroupTradesDialog";
import { Button } from "@/components/ui/button";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";

const formatDate = (timestamp: number) => {
    if (!timestamp) return '';
    const d = new Date(timestamp * 1000);
    const yy = d.getFullYear().toString().slice(-2);
    const mm = (d.getMonth() + 1).toString().padStart(2, '0');
    const dd = d.getDate().toString().padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
};

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const formatOptionTicker = (opt: any) => {
    if (!opt) return '-';
    
    const quantityStr = opt.quantity != null ? `${opt.quantity}${opt.type === 'STK' ? '股' : '口'}` : '';
    const quantityBlock = quantityStr ? (
        <span className="bg-slate-100 px-1.5 py-0.5 rounded text-xs mr-1 font-mono">{quantityStr}</span>
    ) : null;

    const underlying = opt.underlying;
    if (opt.type === 'STK') {
        const assignedText = opt.is_assigned ? '，被行權' : '';
        const priceText = opt.underlying_price != null ? ` (均價 ${opt.underlying_price.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}${assignedText})` : assignedText;
        return <>{quantityBlock}{underlying}{priceText}</>;
    }
    const typeChar = opt.type === 'PUT' ? 'P' : 'C';
    const strike = opt.strike_price;
    if (!opt.to_date) return <>{quantityBlock}{underlying} - {strike}{typeChar}</>;
    const d = new Date(opt.to_date * 1000);
    const mon = MONTH_ABBR[d.getMonth()];
    const day = d.getDate();
    const yr = d.getFullYear().toString().slice(-2);
    return <>{quantityBlock}{underlying} {mon}{day}'{yr} {strike}{typeChar}</>;
};

interface GroupStat {
    ownerId: number;
    ownerName: string;
    name: string;
    count: number;
    profit: number;
    startDate: number;
    endDate: number;
    latestTrade: any;
    contentTypes: string;
    status: 'Active' | 'Terminated';
    note?: string | null;
    note_color?: string | null;
    next_group?: string | null;
    holdingShares?: number;
    holdingAvgPrice?: number;
    underlyings?: string[];
}

export default function TradeGroupsPage() {
    const { selectedYear } = useYearFilter();
    const [mounted, setMounted] = useState(false);
    const [users, setUsers] = useState<any[]>([]);
    const [selectedUserValue, setSelectedUserValue] = useState<string>('All');
    const [selectedSymbolValue, setSelectedSymbolValue] = useState<string>('All');
    const [selectedStatusValue, setSelectedStatusValue] = useState<string>('All');
    const [availableSymbols, setAvailableSymbols] = useState<string[]>([]);
    const [groupStats, setGroupStats] = useState<GroupStat[]>([]);
    const [allTrades, setAllTrades] = useState<any[]>([]);
    const [selectedGroup, setSelectedGroup] = useState<{name: string, ownerId: number, ownerName: string} | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const { toast } = useToast();
    const router = useRouter();

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        if (!mounted) return;
        // Fetch users
        const fetchUsers = async () => {
            try {
                const yearParam = selectedYear === 'All' ? '' : `&year=${selectedYear}`;
                const res = await fetch(`/api/users?mode=selection&roles=customer${yearParam}`);
                const data = await res.json();
                
                // Deduplicate users by user_id or email
                const uniqueUsers = [];
                const seen = new Set();
                for (const u of (data.users || [])) {
                    const identifier = u.user_id || u.email;
                    if (identifier && !seen.has(identifier)) {
                        seen.add(identifier);
                        uniqueUsers.push(u);
                    }
                }
                
                setUsers(uniqueUsers);
            } catch (error) {
                console.error("Failed to fetch users", error);
            }
        };
        fetchUsers();
    }, [mounted, selectedYear]);

    useEffect(() => {
        if (!mounted) return;
        const loadGroupData = async () => {
            setIsLoading(true);
            try {
                const year = selectedYear === 'All' ? new Date().getFullYear() : selectedYear;
                
                // Determine which user(s) to fetch
                let currentOwnerId = selectedUserValue;
                if (selectedUserValue !== 'All') {
                    const u = users.find(user => user.user_id === selectedUserValue || user.email === selectedUserValue);
                    currentOwnerId = u ? u.id : selectedUserValue;
                }

                const yearParam = `year=${year}`;
                const q = currentOwnerId !== 'All' ? `ownerId=${currentOwnerId}&${yearParam}` : yearParam;

                // 1. Fetch options and stocks
                const [optRes, stkRes] = await Promise.all([
                    fetch(`/api/options?${q}`),
                    fetch(`/api/stocks?${q}`)
                ]);
                const optData = await optRes.json();
                const stkData = await stkRes.json();
                
                const currentOptions = optData.options || [];
                if (stkData.stocks) {
                    const mappedStks = stkData.stocks.map((st: any) => ({
                        id: st.id,
                        group_id: st.group_id || st.close_group_id,
                        open_date: st.open_date,
                        settlement_date: st.close_date,
                        final_profit: st.status === 'Closed' ? (st.close_price - st.open_price) * st.quantity : (st.current_market_price ? (st.current_market_price - st.open_price) * st.quantity : null),
                        type: 'STK',
                        underlying: st.symbol,
                        status: st.status,
                        quantity: st.quantity,
                        underlying_price: st.open_price,
                        operation: st.status,
                        owner_id: st.owner_id,
                        note: st.note,
                        note_color: st.note_color,
                        code: st.code,
                        has_separator: st.has_separator
                    }));
                    currentOptions.push(...mappedStks);
                }

                // Create user map for fast lookup
                const userMap = new Map();
                users.forEach(u => userMap.set(u.id, u.user_id || u.email));

                setAllTrades(currentOptions);

                // 2. Calculate local stats grouped by ownerId + groupName
                const statsMap = new Map<string, { ownerId: number, count: number, profit: number, minDate: number, maxDate: number, latestTrade: any, types: Set<string>, holdingShares: number, holdingCost: number, underlyings: Set<string> }>();
                
                currentOptions.forEach((opt: any) => {
                    const groupName = opt.group_id?.toString().trim();
                    if (!groupName) return;
                    const optOwnerId = opt.owner_id;
                    if (!optOwnerId) return;

                    const tradeDate = opt.open_date;
                    const mapKey = `${optOwnerId}_${groupName}`;

                    if (!statsMap.has(mapKey)) {
                        statsMap.set(mapKey, { ownerId: optOwnerId, count: 0, profit: 0, minDate: tradeDate, maxDate: tradeDate, latestTrade: opt, types: new Set<string>(), holdingShares: 0, holdingCost: 0, underlyings: new Set<string>() });
                    }
                    const stat = statsMap.get(mapKey)!;
                    stat.count += 1;
                    stat.profit += (opt.final_profit || 0);
                    
                    if (opt.type === 'STK') {
                        stat.types.add(opt.underlying || '股票');
                        stat.holdingShares += opt.quantity || 0;
                        stat.holdingCost += (opt.quantity || 0) * (opt.underlying_price || 0);
                    }
                    else if (opt.type === 'CALL') stat.types.add('CALL');
                    else if (opt.type === 'PUT') stat.types.add('PUT');
                    
                    if (opt.underlying) {
                        stat.underlyings.add(opt.underlying);
                    }
                    
                    if (tradeDate < stat.minDate) stat.minDate = tradeDate;
                    if (tradeDate > stat.maxDate) {
                        stat.maxDate = tradeDate;
                        stat.latestTrade = opt;
                    } else if (tradeDate === stat.maxDate && opt.id > stat.latestTrade.id) {
                        stat.latestTrade = opt;
                    }
                });

                // 3. Fetch statuses from DB
                const dbRes = await fetch(`/api/trade-groups?${q}`);
                const dbData = await dbRes.json();
                
                const dbStatusMap = new Map<string, any>();
                if (dbData.groups) {
                    dbData.groups.forEach((g: any) => {
                        dbStatusMap.set(`${g.owner_id}_${g.id}`, g);
                        // Fallback for un-migrated records where group_id is still a string name
                        dbStatusMap.set(`${g.owner_id}_${g.name}`, g);
                    });
                }

                // 4. Merge
                const mergedStats: GroupStat[] = Array.from(statsMap.entries()).map(([key, stat]) => {
                    const [, _name] = key.split('_'); // key is ownerId_name or ownerId_id
                    const dbGroup = dbStatusMap.get(key) || {};
                    
                    // If dbGroup has a name, use it (handles cases where key contains the integer ID)
                    // Otherwise fallback to whatever is in the key
                    const actualName = dbGroup.name || key.substring(key.indexOf('_') + 1);
                    
                    const sortedTypes = Array.from(stat.types).sort((a, b) => {
                        const aIsOption = a === 'CALL' || a === 'PUT';
                        const bIsOption = b === 'CALL' || b === 'PUT';
                        if (!aIsOption && bIsOption) return -1;
                        if (aIsOption && !bIsOption) return 1;
                        if (aIsOption && bIsOption) return a === 'CALL' ? -1 : 1;
                        return a.localeCompare(b);
                    });
                    
                    const ownerName = userMap.get(stat.ownerId) || `User ${stat.ownerId}`;
                    
                    return {
                        ownerId: stat.ownerId,
                        ownerName,
                        name: actualName,
                        count: stat.count,
                        profit: stat.profit,
                        startDate: stat.minDate,
                        endDate: stat.maxDate,
                        latestTrade: stat.latestTrade,
                        contentTypes: sortedTypes.join('、'),
                        status: (dbGroup.status as 'Active' | 'Terminated') || 'Active',
                        note: dbGroup.note,
                        note_color: dbGroup.note_color,
                        next_group: dbGroup.next_group,
                        holdingShares: stat.holdingShares,
                        holdingAvgPrice: stat.holdingShares !== 0 ? Math.abs(stat.holdingCost / stat.holdingShares) : 0,
                        underlyings: Array.from(stat.underlyings)
                    };
                });

                // Sort by status, then by account, then by name
                mergedStats.sort((a, b) => {
                    if (a.status !== b.status) {
                        return a.status === 'Active' ? -1 : 1;
                    }
                    if (a.ownerName !== b.ownerName) {
                        return a.ownerName.localeCompare(b.ownerName);
                    }
                    const getPrefixWeight = (str: string) => {
                        if (str.startsWith('QQQ')) return 1;
                        if (str.startsWith('TQQQ')) return 2;
                        if (str.startsWith('GROUP')) return 3;
                        return 4;
                    };
                    const weightA = getPrefixWeight(a.name);
                    const weightB = getPrefixWeight(b.name);
                    if (weightA !== weightB) return weightA - weightB;
                    return a.name.localeCompare(b.name);
                });
                
                const allUnderlyings = new Set<string>();
                mergedStats.forEach(g => {
                    g.underlyings?.forEach(sym => allUnderlyings.add(sym));
                });
                setAvailableSymbols(Array.from(allUnderlyings).sort());
                setGroupStats(mergedStats);
            } catch (error) {
                console.error('Failed to load group data:', error);
                toast({
                    title: "載入失敗",
                    description: "無法取得群組狀態資料",
                    variant: "destructive",
                });
            } finally {
                setIsLoading(false);
            }
        };

        loadGroupData();
    }, [mounted, selectedYear, selectedUserValue, users, toast]);

    const handleNoteUpdate = async (ownerId: number, groupName: string, newNote: string) => {
        const year = selectedYear === 'All' ? new Date().getFullYear() : selectedYear;
        setGroupStats(prev => prev.map(g => g.ownerId === ownerId && g.name === groupName ? { ...g, note: newNote } : g));
        try {
            const res = await fetch(`/api/trade-groups/note`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ownerId,
                    year,
                    name: groupName,
                    note: newNote || null
                })
            });
            if (!res.ok) throw new Error('Failed to update note');
        } catch (error) {
            console.error('Update note error:', error);
            toast({ title: "更新失敗", description: "無法更新註解", variant: "destructive" });
        }
    };

    const handleColorToggle = async (ownerId: number, groupName: string, currentColor?: string | null) => {
        const year = selectedYear === 'All' ? new Date().getFullYear() : selectedYear;
        const colors = ['red', 'green', 'blue'];
        const nextColor = currentColor ? colors[(colors.indexOf(currentColor) + 1) % colors.length] : 'red';
        
        setGroupStats(prev => prev.map(g => g.ownerId === ownerId && g.name === groupName ? { ...g, note_color: nextColor } : g));
        try {
            const res = await fetch(`/api/trade-groups/note`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ownerId,
                    year,
                    name: groupName,
                    note_color: nextColor
                })
            });
            if (!res.ok) throw new Error('Failed to update note color');
        } catch (error) {
            console.error('Update note color error:', error);
            setGroupStats(prev => prev.map(g => g.ownerId === ownerId && g.name === groupName ? { ...g, note_color: currentColor } : g));
            toast({ title: "更新失敗", description: "無法更新註解顏色", variant: "destructive" });
        }
    };

    const handleStatusChange = async (ownerId: number, groupName: string, newStatus: string) => {
        const year = selectedYear === 'All' ? new Date().getFullYear() : selectedYear;
        // Optimistic update
        const previousStats = [...groupStats];
        setGroupStats(prev => prev.map(g => g.ownerId === ownerId && g.name === groupName ? { ...g, status: newStatus as 'Active' | 'Terminated' } : g));

        try {
            const res = await fetch('/api/trade-groups', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ownerId,
                    year,
                    name: groupName,
                    status: newStatus
                })
            });

            if (!res.ok) throw new Error('Failed to update status');
        } catch (error) {
            console.error('Failed to update status:', error);
            setGroupStats(previousStats);
            toast({
                title: "更新失敗",
                description: "無法更新群組狀態",
                variant: "destructive",
            });
        }
    };

    const handleNextGroupChange = async (ownerId: number, groupName: string, newNextGroup: string) => {
        const year = selectedYear === 'All' ? new Date().getFullYear() : selectedYear;
        // Optimistic update
        const previousStats = [...groupStats];
        setGroupStats(prev => prev.map(g => g.ownerId === ownerId && g.name === groupName ? { ...g, next_group: newNextGroup === 'none' ? null : newNextGroup } : g));

        try {
            const res = await fetch('/api/trade-groups/next-group', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ownerId,
                    year,
                    name: groupName,
                    next_group: newNextGroup === 'none' ? null : newNextGroup
                })
            });

            if (!res.ok) throw new Error('Failed to update next group');
        } catch (error) {
            console.error('Failed to update next group:', error);
            setGroupStats(previousStats);
            toast({
                title: "更新失敗",
                description: "無法更新接手群組",
                variant: "destructive",
            });
        }
    };

    if (!mounted) return null;

    const filteredGroupStats = groupStats.filter(g => {
        if (selectedSymbolValue !== 'All' && !g.underlyings?.includes(selectedSymbolValue)) {
            return false;
        }
        if (selectedStatusValue !== 'All' && g.status !== selectedStatusValue) {
            return false;
        }
        return true;
    });

    const totalProfit = filteredGroupStats.reduce((sum, g) => sum + (g.profit || 0), 0);

    let totalCash = 0;
    let totalNetEquity = 0;
    let totalPutCapital = 0;
    let totalDebt = 0;

    if (selectedUserValue !== 'All') {
        const u = users.find(u => u.user_id === selectedUserValue || u.email === selectedUserValue);
        if (u) {
            totalCash = u.current_cash_balance || 0;
            totalNetEquity = u.current_net_equity !== undefined ? u.current_net_equity : ((u.initial_cost || 0) + (u.net_deposit || 0) + (u.total_profit || 0));
            totalPutCapital = u.open_put_covered_capital || 0;
            totalDebt = Math.abs(Math.min(0, u.current_cash_balance || 0));
        }
    } else {
        for (const u of users) {
            totalCash += (u.current_cash_balance || 0);
            totalNetEquity += u.current_net_equity !== undefined ? u.current_net_equity : ((u.initial_cost || 0) + (u.net_deposit || 0) + (u.total_profit || 0));
            totalPutCapital += (u.open_put_covered_capital || 0);
            totalDebt += Math.abs(Math.min(0, u.current_cash_balance || 0));
        }
    }

    const marginUsed = totalPutCapital + totalDebt;
    const marginRate = totalNetEquity > 0 ? (marginUsed / totalNetEquity) * 100 : 0;

    return (
        <TooltipProvider delayDuration={300}>
            <div className="container mx-auto py-10 max-w-[1400px]">
                <div className="mb-8 flex justify-between items-center">
                    <h1 className="text-3xl font-bold flex items-center gap-4">
                        {selectedYear === 'All' ? new Date().getFullYear() : selectedYear} 交易群組
                        {isLoading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
                    </h1>
                    <div className="flex items-center gap-2">
                        <div className="px-4 h-10 flex items-center justify-center border border-input bg-background rounded-md text-sm shadow-sm text-foreground gap-1.5">
                            現金 <span className={totalCash >= 0 ? "text-green-700 font-medium" : "text-red-700 font-medium"}>{totalCash > 0 ? '+' : ''}{Math.round(totalCash).toLocaleString('en-US')}</span>
                        </div>
                        <div className="px-4 h-10 flex items-center justify-center border border-input bg-background rounded-md text-sm shadow-sm text-foreground gap-1.5">
                            融資 <span className="font-medium">{marginRate.toFixed(1)}%</span>
                        </div>
                        <div className="mr-2 px-4 h-10 flex items-center justify-center border border-input bg-background rounded-md text-sm shadow-sm text-foreground gap-1.5">
                            群組盈虧 <span className={totalProfit >= 0 ? "text-green-700 font-medium" : "text-red-700 font-medium"}>{totalProfit > 0 ? '+' : ''}{totalProfit.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                        </div>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={() => {
                                        setSelectedUserValue("All");
                                        setSelectedStatusValue("All");
                                        setSelectedSymbolValue("All");
                                    }}
                                    className="mr-2 text-muted-foreground hover:text-primary"
                                >
                                    <FilterX className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>重置篩選</p>
                            </TooltipContent>
                        </Tooltip>

                        <Select
                        value={selectedUserValue}
                        onValueChange={(val) => setSelectedUserValue(val)}
                    >
                        <SelectTrigger className="w-[200px]">
                            <SelectValue placeholder="選擇用戶" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="All">所有用戶</SelectItem>
                            {[...users].sort((a: any, b: any) => (a.user_id || a.email).localeCompare(b.user_id || b.email)).map((user: any) => (
                                <SelectItem key={user.id} value={user.user_id || user.email}>
                                    {user.user_id || user.email}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Select
                        value={selectedStatusValue}
                        onValueChange={(val) => setSelectedStatusValue(val)}
                    >
                        <SelectTrigger className="w-[150px]">
                            <SelectValue placeholder="選擇狀態" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="All">所有狀態</SelectItem>
                            <SelectItem value="Active">進行中</SelectItem>
                            <SelectItem value="Terminated">已終止</SelectItem>
                        </SelectContent>
                    </Select>
                    <Select
                        value={selectedSymbolValue}
                        onValueChange={(val) => setSelectedSymbolValue(val)}
                    >
                        <SelectTrigger className="w-[150px]">
                            <SelectValue placeholder="選擇標的" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="All">所有標的</SelectItem>
                            {availableSymbols.map((sym: string) => (
                                <SelectItem key={sym} value={sym}>
                                    {sym}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>

            <div className={`space-y-4 transition-opacity duration-200 ${isLoading ? 'opacity-50 pointer-events-none' : ''}`}>

                
                <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
                    <Table className="text-[13px]">
                        <TableHeader>
                            <TableRow className="bg-muted/50">
                                <TableHead className="w-[40px] text-center"></TableHead>
                                <TableHead className="min-w-[150px]"></TableHead>
                                <TableHead className="w-[120px]">帳戶</TableHead>
                                <TableHead>群組</TableHead>
                                <TableHead className="text-center">內容</TableHead>
                                <TableHead className="text-center">起始日</TableHead>
                                <TableHead>最後交易</TableHead>
                                <TableHead>持股成本</TableHead>
                                <TableHead className="text-center">筆數</TableHead>
                                <TableHead className="text-center">盈虧</TableHead>
                                <TableHead className="w-[100px] text-center">接手群組</TableHead>
                                <TableHead className="w-[120px] text-center">狀態</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredGroupStats.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={12} className="text-center py-8 text-muted-foreground">
                                        目前沒有群組資料
                                    </TableCell>
                                </TableRow>
                            ) : (
                                filteredGroupStats.map((group, index) => {
                                    const isBoundary = index > 0 && filteredGroupStats[index - 1].status === 'Active' && group.status === 'Terminated';
                                    return (
                                        <React.Fragment key={`${group.ownerId}_${group.name}`}>
                                            {isBoundary && (
                                                <TableRow className="bg-slate-100/80 hover:bg-slate-100/80 border-y-2 border-slate-200">
                                                    <TableCell colSpan={12} className="h-12 text-center p-0 align-middle">
                                                        <span className="inline-block bg-white text-slate-500 text-xs font-bold px-4 py-1.5 rounded-full border shadow-sm tracking-widest">
                                                            已 終 止 群 組
                                                        </span>
                                                    </TableCell>
                                                </TableRow>
                                            )}
                                            <TableRow>
                                                <TableCell className="text-center text-[13px] text-foreground font-mono">{filteredGroupStats.length - index}</TableCell>
                                                <TableCell>
                                            <div className="flex items-center gap-2 min-w-[150px]">
                                                {group.note?.trim() ? (
                                                    <button 
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.preventDefault();
                                                            handleColorToggle(group.ownerId, group.name, group.note_color);
                                                        }}
                                                        className={`w-4 h-4 rounded-full flex-shrink-0 cursor-pointer shadow-sm transition-colors opacity-90 hover:opacity-100 ${
                                                            group.note_color === 'red' ? 'bg-red-500' : group.note_color === 'green' ? 'bg-green-600' : 'bg-blue-500'
                                                        }`}
                                                        title="切換註解顏色"
                                                    />
                                                ) : (
                                                    <div className="w-4 h-4 flex-shrink-0" />
                                                )}
                                                <input 
                                                    type="text" 
                                                    className="w-full bg-transparent border-b border-transparent hover:border-gray-300 focus:border-primary focus:outline-none transition-colors px-1 text-left text-[13px] font-medium"
                                                    style={{ color: group.note_color === 'red' ? '#7f1d1d' : group.note_color === 'green' ? '#15803d' : '#1e3a8a' }}
                                                    placeholder="..."
                                                    defaultValue={group.note || ''}
                                                    onBlur={(e) => {
                                                        if (e.target.value !== (group.note || '')) {
                                                            handleNoteUpdate(group.ownerId, group.name, e.target.value);
                                                        }
                                                    }}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            e.currentTarget.blur();
                                                        }
                                                    }}
                                                />
                                            </div>
                                        </TableCell>
                                        <TableCell className="font-medium text-muted-foreground">
                                            <span className="bg-primary/10 text-foreground px-2 py-0.5 rounded font-semibold text-xs inline-flex items-center gap-1.5">
                                                {group.ownerName}
                                            </span>
                                        </TableCell>
                                        <TableCell className="font-medium">
                                            <button 
                                                type="button"
                                                onClick={() => {
                                                    setSelectedGroup({name: group.name, ownerId: group.ownerId, ownerName: group.ownerName});
                                                }}
                                                className="text-foreground hover:text-foreground/80 hover:underline cursor-pointer"
                                            >
                                                {group.name}
                                            </button>
                                        </TableCell>
                                        <TableCell className="text-center text-foreground">
                                            {(() => {
                                                if (!group.contentTypes) return '-';
                                                let parts = group.contentTypes.split('、');
                                                if (parts.includes('CALL') && parts.includes('PUT')) {
                                                    parts = parts.filter(p => p !== 'CALL' && p !== 'PUT');
                                                    parts.push('雙腿');
                                                }
                                                return parts.join('、');
                                            })()}
                                        </TableCell>
                                        <TableCell className="text-center">{formatDate(group.startDate)}</TableCell>
                                        <TableCell className="whitespace-nowrap">
                                            {formatOptionTicker(group.latestTrade)}
                                            {group.latestTrade && (() => {
                                                const op = group.latestTrade.operation || 'Open';
                                                let badgeClass = "ml-2 px-2 py-0.5 rounded-sm text-xs font-medium ";
                                                if (op === 'Assigned') badgeClass += "text-red-600 bg-red-50";
                                                else if (op === 'Expired') badgeClass += "bg-green-50 text-green-700 rounded-full";
                                                else if (op === 'Transferred') badgeClass += "bg-blue-50 text-blue-700 rounded-full";
                                                else if (op === 'Closed') badgeClass += "bg-slate-100 text-slate-700 rounded-full";
                                                else badgeClass += "text-slate-600";
                                                
                                                return (
                                                    <span className={badgeClass}>{op}</span>
                                                );
                                            })()}
                                        </TableCell>
                                        <TableCell className="whitespace-nowrap">
                                            {group.holdingShares && group.holdingShares !== 0 ? (
                                                <span className="text-foreground">
                                                    股{Math.abs(group.holdingShares).toLocaleString('en-US')}，均{group.holdingAvgPrice?.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                                                </span>
                                            ) : '-'}
                                        </TableCell>
                                        <TableCell className="text-center">{group.count}</TableCell>
                                        <TableCell className={`text-center font-medium ${group.profit > 0 ? 'text-green-700' : group.profit < 0 ? 'text-red-700' : ''}`}>
                                            {group.profit > 0 ? '+' : ''}{Math.round(group.profit).toLocaleString('en-US')}
                                        </TableCell>
                                        <TableCell>
                                            <Select value={group.next_group || 'none'} onValueChange={(val) => handleNextGroupChange(group.ownerId, group.name, val)}>
                                                <SelectTrigger hideIcon className="h-8 w-[90px] text-[13px] mx-auto justify-center bg-transparent hover:bg-slate-100 border-none shadow-none focus:ring-0">
                                                    <SelectValue placeholder="-" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="none" hideCheck className="text-muted-foreground">-</SelectItem>
                                                    {[
                                                        'QQQ-0', 'QQQ-1', 'QQQ-2', 'QQQ-3', 'QQQ-4', 'QQQ-5',
                                                        'TQQQ-0', 'TQQQ-1', 'TQQQ-2', 'TQQQ-3', 'TQQQ-4', 'TQQQ-5',
                                                        'GROUP-0', 'GROUP-1', 'GROUP-2', 'GROUP-3', 'GROUP-4', 'GROUP-5'
                                                    ].map(n => (
                                                        <SelectItem key={n} value={n} hideCheck>{n}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </TableCell>
                                        <TableCell>
                                            <Select value={group.status} onValueChange={(val) => handleStatusChange(group.ownerId, group.name, val)}>
                                                <SelectTrigger hideIcon className={`h-8 w-[100px] text-[13px] mx-auto justify-center ${group.status === 'Terminated' ? 'bg-blue-50' : ''}`}>
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="Active" hideCheck>進行中</SelectItem>
                                                    <SelectItem value="Terminated" hideCheck>已終止</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </TableCell>
                                            </TableRow>
                                        </React.Fragment>
                                    );
                                })
                            )}
                        </TableBody>
                    </Table>
                </div>
            </div>

            {selectedGroup && (
                <GroupTradesDialog
                    isOpen={!!selectedGroup}
                    onOpenChange={(open) => !open && setSelectedGroup(null)}
                    groupName={selectedGroup.name}
                    ownerName={selectedGroup.ownerName}
                    availableGroups={groupStats.filter(g => g.ownerId === selectedGroup.ownerId).map(g => ({name: g.name, status: g.status}))}
                    onGroupSelect={(name) => setSelectedGroup({ ...selectedGroup, name })}
                    trades={allTrades.filter(t => t.group_id === selectedGroup.name && t.owner_id === selectedGroup.ownerId)}
                />
            )}
        </div>
        </TooltipProvider>
    );
}
