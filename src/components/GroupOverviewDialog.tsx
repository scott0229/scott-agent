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

interface GroupOverviewDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    options: any[];
    ownerId: number | null;
    year: string | number;
    onStatusChange?: () => void;
    titlePrefix?: string;
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
}

export function GroupOverviewDialog({ isOpen, onOpenChange, options, ownerId, year, onStatusChange, titlePrefix }: GroupOverviewDialogProps) {
    const [groupStats, setGroupStats] = useState<GroupStat[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const { toast } = useToast();

    useEffect(() => {
        if (!isOpen || !ownerId || !year) return;

        const loadGroupData = async () => {
            setIsLoading(true);
            try {
                // 1. Calculate local stats
                const statsMap = new Map<string, { count: number, profit: number, minDate: number, maxDate: number, latestTrade: any, types: Set<string> }>();
                
                options.forEach(opt => {
                    const groupName = opt.group_id?.toString().trim();
                    if (!groupName) return;

                    const tradeDate = opt.open_date;

                    if (!statsMap.has(groupName)) {
                        statsMap.set(groupName, { count: 0, profit: 0, minDate: tradeDate, maxDate: tradeDate, latestTrade: opt, types: new Set<string>() });
                    }
                    const stat = statsMap.get(groupName)!;
                    stat.count += 1;
                    stat.profit += (opt.final_profit || 0);
                    
                    if (opt.type === 'STK') stat.types.add('股票');
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
                const res = await fetch(`/api/trade-groups?ownerId=${ownerId}&year=${year}`);
                const data = await res.json();
                
                const dbStatusMap = new Map<string, string>();
                if (data.groups) {
                    data.groups.forEach((g: any) => {
                        dbStatusMap.set(g.name, g.status);
                    });
                }

                // 3. Merge
                const mergedStats: GroupStat[] = Array.from(statsMap.entries()).map(([name, stat]) => {
                    const typeOrder = ['股票', 'CALL', 'PUT'];
                    const sortedTypes = Array.from(stat.types).sort((a, b) => typeOrder.indexOf(a) - typeOrder.indexOf(b));
                    
                    return {
                        name,
                        count: stat.count,
                        profit: stat.profit,
                        startDate: stat.minDate,
                        endDate: stat.maxDate,
                        latestTrade: stat.latestTrade,
                        contentTypes: sortedTypes.join('、'),
                        status: (dbStatusMap.get(name) as 'Active' | 'Terminated') || 'Active'
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
    }, [isOpen, options, ownerId, year]);

    const handleStatusChange = async (groupName: string, newStatus: string) => {
        if (!ownerId || !year) return;
        
        // Optimistic update
        const previousStats = [...groupStats];
        setGroupStats(prev => prev.map(g => g.name === groupName ? { ...g, status: newStatus as 'Active' | 'Terminated' } : g));

        try {
            const res = await fetch('/api/trade-groups', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ownerId,
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
            <DialogContent className="sm:max-w-4xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{titlePrefix ? `${titlePrefix} 群組總覽` : '群組總覽'}</DialogTitle>
                </DialogHeader>

                {isLoading ? (
                    <div className="py-8 text-center text-muted-foreground">載入中...</div>
                ) : (
                    <div className="space-y-4">
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
                                <TableHead>群組名稱</TableHead>
                                <TableHead className="text-center">內容</TableHead>
                                <TableHead className="text-center">起始日</TableHead>
                                <TableHead className="text-center">最後交易</TableHead>
                                <TableHead className="text-center">交易筆數</TableHead>
                                <TableHead className="text-center">總收益</TableHead>
                                <TableHead className="w-[120px] text-center">狀態</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {groupStats.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                                        目前沒有群組資料
                                    </TableCell>
                                </TableRow>
                            ) : (
                                groupStats.map((group, index) => (
                                    <TableRow key={group.name}>
                                        <TableCell className="text-center text-[13px] text-foreground font-mono">{index + 1}</TableCell>
                                        <TableCell className="font-medium">{group.name}</TableCell>
                                        <TableCell className="text-center">{group.contentTypes}</TableCell>
                                        <TableCell className="text-center">{formatDate(group.startDate)}</TableCell>
                                        <TableCell className="text-center whitespace-nowrap">
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
                                        <TableCell className="text-center">{group.count}</TableCell>
                                        <TableCell className={`text-center font-medium ${group.profit > 0 ? 'text-green-700' : group.profit < 0 ? 'text-red-700' : ''}`}>
                                            {group.profit > 0 ? '+' : ''}{Math.round(group.profit).toLocaleString('en-US')}
                                        </TableCell>
                                        <TableCell>
                                            <Select value={group.status} onValueChange={(val) => handleStatusChange(group.name, val)}>
                                                <SelectTrigger hideIcon className={`h-8 w-[100px] mx-auto justify-center ${group.status === 'Terminated' ? 'bg-blue-50' : ''}`}>
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
                )}
            </DialogContent>
        </Dialog>
    );
}
