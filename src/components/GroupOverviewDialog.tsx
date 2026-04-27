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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

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
    const quantityStr = opt.quantity != null ? `${opt.quantity}${opt.type === 'STK' ? '股' : '口'} ` : '';
    const underlying = opt.underlying;
    if (opt.type === 'STK') {
        const assignedText = opt.is_assigned ? '，被行權' : '';
        return opt.underlying_price != null ? `${quantityStr}${underlying} (均價 ${opt.underlying_price.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}${assignedText})` : `${quantityStr}${underlying}${assignedText}`;
    }
    const typeChar = opt.type === 'PUT' ? 'P' : 'C';
    const strike = opt.strike_price;
    if (!opt.to_date) return `${quantityStr}${underlying} - ${strike}${typeChar}`;
    const d = new Date(opt.to_date * 1000);
    const mon = MONTH_ABBR[d.getMonth()];
    const day = d.getDate();
    const yr = d.getFullYear().toString().slice(-2);
    return `${quantityStr}${underlying} ${mon}${day}'${yr} ${strike}${typeChar}`;
};

interface GroupOverviewDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    options: any[];
    ownerId: number | null;
    year: string | number;
    onStatusChange?: () => void;
    titlePrefix?: string;
    onSelectGroup?: (groupName: string) => void;
    users?: any[];
    currentUserRole?: string | null;
    selectedUserValue?: string;
    onUserChange?: (newId: string, targetGroup?: string) => void;
}

interface GroupStat {
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
    holdingShares?: number;
    holdingAvgPrice?: number;
}

export function GroupOverviewDialog({ 
    isOpen, onOpenChange, options, ownerId, year, onStatusChange, titlePrefix, onSelectGroup,
    users, currentUserRole, selectedUserValue, onUserChange
}: GroupOverviewDialogProps) {
    const [groupStats, setGroupStats] = useState<GroupStat[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const { toast } = useToast();

    const [localUserId, setLocalUserId] = useState<string | null>(null);
    const [localOptions, setLocalOptions] = useState<any[] | null>(null);

    // Reset local state when dialog closes
    useEffect(() => {
        if (!isOpen) {
            setLocalUserId(null);
            setLocalOptions(null);
        }
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen || !year) return;

        if (!localUserId || localUserId === selectedUserValue) {
            setLocalOptions(null);
            return;
        }

        const fetchLocalData = async () => {
            setIsLoading(true);
            try {
                const u = users?.find(user => user.user_id === localUserId || user.email === localUserId);
                const currentOwnerId = u ? u.id : localUserId;
                const yearParam = year === 'All' ? '' : `&year=${year}`;
                const q = localUserId !== 'All' ? `ownerId=${currentOwnerId}${yearParam}` : (year === 'All' ? '' : `year=${year}`);

                const [optRes, stkRes] = await Promise.all([
                    fetch(`/api/options?${q}`),
                    fetch(`/api/stocks?${q}`)
                ]);
                const optData = await optRes.json();
                const stkData = await stkRes.json();
                
                const finalOpts = optData.options || [];
                if (stkData.stocks) {
                    const mappedStks = stkData.stocks.map((st: any) => ({
                        id: st.id,
                        group_id: st.group_id || st.close_group_id,
                        open_date: st.open_date,
                        final_profit: st.status === 'Closed' ? (st.close_price - st.open_price) * st.quantity : (st.current_market_price ? (st.current_market_price - st.open_price) * st.quantity : null),
                        type: 'STK',
                        underlying: st.symbol,
                        status: st.status,
                        quantity: st.quantity,
                        underlying_price: st.open_price,
                        operation: st.status
                    }));
                    finalOpts.push(...mappedStks);
                }
                setLocalOptions(finalOpts);
            } catch (error) {
                console.error('Failed to fetch local options:', error);
                toast({
                    title: "載入失敗",
                    description: "無法取得該用戶資料",
                    variant: "destructive",
                });
            } finally {
                setIsLoading(false);
            }
        };

        fetchLocalData();
    }, [isOpen, localUserId, selectedUserValue, year, users]);

    useEffect(() => {
        if (!isOpen || !ownerId || !year) return;
        
        if (localUserId && localUserId !== selectedUserValue && !localOptions) return;

        const loadGroupData = async () => {
            setIsLoading(true);
            try {
                const currentOptions = localOptions || options;
                const currentOwnerId = localUserId ? (users?.find(u => u.user_id === localUserId || u.email === localUserId)?.id || localUserId) : ownerId;

                // 1. Calculate local stats
                const statsMap = new Map<string, { count: number, profit: number, minDate: number, maxDate: number, latestTrade: any, types: Set<string>, holdingShares: number, holdingCost: number }>();
                
                currentOptions.forEach(opt => {
                    const groupName = opt.group_id?.toString().trim();
                    if (!groupName) return;

                    const tradeDate = opt.open_date;

                    if (!statsMap.has(groupName)) {
                        statsMap.set(groupName, { count: 0, profit: 0, minDate: tradeDate, maxDate: tradeDate, latestTrade: opt, types: new Set<string>(), holdingShares: 0, holdingCost: 0 });
                    }
                    const stat = statsMap.get(groupName)!;
                    stat.count += 1;
                    stat.profit += (opt.final_profit || 0);
                    
                    if (opt.type === 'STK') {
                        stat.types.add(opt.underlying || '股票');
                        stat.holdingShares += opt.quantity || 0;
                        stat.holdingCost += (opt.quantity || 0) * (opt.underlying_price || 0);
                    }
                    else if (opt.type === 'CALL') stat.types.add('CALL');
                    else if (opt.type === 'PUT') stat.types.add('PUT');
                    
                    if (tradeDate < stat.minDate) stat.minDate = tradeDate;
                    if (tradeDate > stat.maxDate) {
                        stat.maxDate = tradeDate;
                        stat.latestTrade = opt;
                    } else if (tradeDate === stat.maxDate && opt.id > stat.latestTrade.id) {
                        stat.latestTrade = opt;
                    }
                });

                // 2. Fetch statuses from DB
                const res = await fetch(`/api/trade-groups?ownerId=${currentOwnerId}&year=${year}`);
                const data = await res.json();
                
                const dbStatusMap = new Map<string, any>();
                if (data.groups) {
                    data.groups.forEach((g: any) => {
                        dbStatusMap.set(g.name, g);
                    });
                }

                // 3. Merge
                const mergedStats: GroupStat[] = Array.from(statsMap.entries()).map(([name, stat]) => {
                    const sortedTypes = Array.from(stat.types).sort((a, b) => {
                        const aIsOption = a === 'CALL' || a === 'PUT';
                        const bIsOption = b === 'CALL' || b === 'PUT';
                        if (!aIsOption && bIsOption) return -1;
                        if (aIsOption && !bIsOption) return 1;
                        if (aIsOption && bIsOption) return a === 'CALL' ? -1 : 1;
                        return a.localeCompare(b);
                    });
                    const dbGroup = dbStatusMap.get(name) || {};
                    
                    return {
                        name,
                        count: stat.count,
                        profit: stat.profit,
                        startDate: stat.minDate,
                        endDate: stat.maxDate,
                        latestTrade: stat.latestTrade,
                        contentTypes: sortedTypes.join('、'),
                        status: (dbGroup.status as 'Active' | 'Terminated') || 'Active',
                        note: dbGroup.note,
                        note_color: dbGroup.note_color,
                        holdingShares: stat.holdingShares,
                        holdingAvgPrice: stat.holdingShares !== 0 ? Math.abs(stat.holdingCost / stat.holdingShares) : 0
                    };
                });

                // Sort by status, then by name
                mergedStats.sort((a, b) => {
                    if (a.status !== b.status) {
                        return a.status === 'Active' ? -1 : 1;
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
    }, [isOpen, options, ownerId, year, localOptions, localUserId, selectedUserValue, users]);

    const handleNoteUpdate = async (groupName: string, newNote: string) => {
        if (!ownerId || !year) return;
        setGroupStats(prev => prev.map(g => g.name === groupName ? { ...g, note: newNote } : g));
        try {
            const res = await fetch(`/api/trade-groups/note`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ownerId,
                    year: year === 'All' ? new Date().getFullYear() : year,
                    name: groupName,
                    note: newNote || null
                })
            });
            if (!res.ok) throw new Error('Failed to update note');
            onStatusChange?.();
        } catch (error) {
            console.error('Update note error:', error);
            toast({ title: "更新失敗", description: "無法更新註解", variant: "destructive" });
        }
    };

    const handleColorToggle = async (groupName: string, currentColor?: string | null) => {
        if (!ownerId || !year) return;
        const colors = ['red', 'green', 'blue'];
        const nextColor = currentColor ? colors[(colors.indexOf(currentColor) + 1) % colors.length] : 'red';
        
        setGroupStats(prev => prev.map(g => g.name === groupName ? { ...g, note_color: nextColor } : g));
        try {
            const res = await fetch(`/api/trade-groups/note`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ownerId,
                    year: year === 'All' ? new Date().getFullYear() : year,
                    name: groupName,
                    note_color: nextColor
                })
            });
            if (!res.ok) throw new Error('Failed to update note color');
            onStatusChange?.();
        } catch (error) {
            console.error('Update note color error:', error);
            setGroupStats(prev => prev.map(g => g.name === groupName ? { ...g, note_color: currentColor } : g));
            toast({ title: "更新失敗", description: "無法更新註解顏色", variant: "destructive" });
        }
    };

    const handleStatusChange = async (groupName: string, newStatus: string) => {
        if (!ownerId || !year) return;
        
        // Optimistic update
        const previousStats = [...groupStats];
        setGroupStats(prev => prev.map(g => g.name === groupName ? { ...g, status: newStatus as 'Active' | 'Terminated' } : g));

        try {
            const currentOwnerId = localUserId ? (users?.find(u => u.user_id === localUserId || u.email === localUserId)?.id || localUserId) : ownerId;
            const res = await fetch('/api/trade-groups', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ownerId: currentOwnerId,
                    year: year === 'All' ? new Date().getFullYear() : year,
                    name: groupName,
                    status: newStatus
                })
            });

            if (!res.ok) throw new Error('Failed to update status');
            onStatusChange?.();
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

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[1200px] max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        群組總覽
                        {currentUserRole && currentUserRole !== 'customer' && users && users.length > 0 ? (
                            <Select
                                value={localUserId || selectedUserValue}
                                onValueChange={(val) => setLocalUserId(val)}
                            >
                                <SelectTrigger className="w-auto h-auto px-2 py-1 text-lg font-bold border-none bg-transparent hover:bg-accent focus:ring-0 focus:ring-offset-0 gap-2">
                                    <SelectValue placeholder="選擇用戶" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="All">所有用戶</SelectItem>
                                    {users.map((user: any) => (
                                        <SelectItem key={user.id} value={user.user_id || user.email}>
                                            {user.user_id || user.email}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        ) : (
                            titlePrefix ? `- ${titlePrefix}` : ''
                        )}
                        {isLoading && <span className="text-sm font-normal text-muted-foreground ml-2">載入中...</span>}
                    </DialogTitle>
                </DialogHeader>

                <div className={`space-y-4 transition-opacity duration-200 ${isLoading ? 'opacity-50 pointer-events-none' : ''}`}>
                        <div className="text-[14px] text-foreground">
                            {(() => {
                                const activeGroupsCount = groupStats.filter(g => g.status === 'Active').length;
                                const totalProfit = groupStats.reduce((sum, g) => sum + g.profit, 0);
                                const profitColorClass = totalProfit > 0 ? 'text-green-700 font-medium' : totalProfit < 0 ? 'text-red-700 font-medium' : '';
                                return (
                                    <>
                                        {groupStats.length} 個群組收益總合 <span className={profitColorClass}>{totalProfit > 0 ? '+' : ''}{Math.round(totalProfit).toLocaleString('en-US')}</span>，{activeGroupsCount} 個群組進行中
                                    </>
                                );
                            })()}
                        </div>
                        <Table className="text-[13px]">
                        <TableHeader>
                            <TableRow className="bg-muted/50">
                                <TableHead className="w-[40px] text-center"></TableHead>
                                <TableHead className="min-w-[180px]"></TableHead>
                                <TableHead>群組名稱</TableHead>
                                <TableHead className="text-center">內容</TableHead>
                                <TableHead className="text-center">起始日</TableHead>
                                <TableHead>最後交易</TableHead>
                                <TableHead className="text-center">持股成本</TableHead>
                                <TableHead className="text-center">筆數</TableHead>
                                <TableHead className="text-center">盈虧</TableHead>
                                <TableHead className="w-[120px] text-center">狀態</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {groupStats.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                                        目前沒有群組資料
                                    </TableCell>
                                </TableRow>
                            ) : (
                                groupStats.map((group, index) => (
                                    <TableRow key={group.name}>
                                        <TableCell className="text-center text-[13px] text-foreground font-mono">{index + 1}</TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-2 min-w-[180px]">
                                                {group.note?.trim() ? (
                                                    <button 
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.preventDefault();
                                                            handleColorToggle(group.name, group.note_color);
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
                                                            handleNoteUpdate(group.name, e.target.value);
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
                                        <TableCell className="font-medium">
                                            <button 
                                                type="button"
                                                onClick={() => {
                                                    if (localUserId && localUserId !== selectedUserValue && onUserChange) {
                                                        onSelectGroup?.(group.name);
                                                        onUserChange(localUserId, group.name);
                                                    } else {
                                                        onSelectGroup?.(group.name);
                                                        onOpenChange(false);
                                                    }
                                                }}
                                                className="text-foreground hover:text-foreground/80 hover:underline cursor-pointer"
                                            >
                                                {group.name}
                                            </button>
                                        </TableCell>
                                        <TableCell className="text-center">{group.contentTypes}</TableCell>
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
                                        <TableCell className="text-center whitespace-nowrap">
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
                                            <Select value={group.status} onValueChange={(val) => handleStatusChange(group.name, val)}>
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
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
            </DialogContent>
        </Dialog>
    );
}
