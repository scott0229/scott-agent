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
                const statsMap = new Map<string, { count: number, profit: number, minDate: number, maxDate: number }>();
                
                options.forEach(opt => {
                    const groupName = opt.group_id?.toString().trim();
                    if (!groupName) return;

                    const tradeDate = opt.open_date;

                    if (!statsMap.has(groupName)) {
                        statsMap.set(groupName, { count: 0, profit: 0, minDate: tradeDate, maxDate: tradeDate });
                    }
                    const stat = statsMap.get(groupName)!;
                    stat.count += 1;
                    stat.profit += (opt.final_profit || 0);
                    if (tradeDate < stat.minDate) stat.minDate = tradeDate;
                    if (tradeDate > stat.maxDate) stat.maxDate = tradeDate;
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
                const mergedStats: GroupStat[] = Array.from(statsMap.entries()).map(([name, stat]) => ({
                    name,
                    count: stat.count,
                    profit: stat.profit,
                    startDate: stat.minDate,
                    endDate: stat.maxDate,
                    status: (dbStatusMap.get(name) as 'Active' | 'Terminated') || 'Active'
                }));

                // Sort by name
                mergedStats.sort((a, b) => {
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
            <DialogContent className="sm:max-w-3xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{titlePrefix ? `${titlePrefix} 群組總覽` : '群組總覽'}</DialogTitle>
                </DialogHeader>

                {isLoading ? (
                    <div className="py-8 text-center text-muted-foreground">載入中...</div>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-muted/50">
                                <TableHead>群組名稱</TableHead>
                                <TableHead className="text-center">起始日</TableHead>
                                <TableHead className="text-center">終止日</TableHead>
                                <TableHead className="text-center">交易筆數</TableHead>
                                <TableHead className="text-center">總收益</TableHead>
                                <TableHead className="w-[120px] text-center">狀態</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {groupStats.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                                        目前沒有群組資料
                                    </TableCell>
                                </TableRow>
                            ) : (
                                groupStats.map((group) => (
                                    <TableRow key={group.name}>
                                        <TableCell className="font-medium">{group.name}</TableCell>
                                        <TableCell className="text-center">{formatDate(group.startDate)}</TableCell>
                                        <TableCell className="text-center">{formatDate(group.endDate)}</TableCell>
                                        <TableCell className="text-center">{group.count}</TableCell>
                                        <TableCell className={`text-center font-medium ${group.profit > 0 ? 'text-green-700' : group.profit < 0 ? 'text-red-700' : ''}`}>
                                            {group.profit > 0 ? '+' : ''}{Math.round(group.profit).toLocaleString('en-US')}
                                        </TableCell>
                                        <TableCell>
                                            <Select value={group.status} onValueChange={(val) => handleStatusChange(group.name, val)}>
                                                <SelectTrigger className={`h-8 w-[100px] mx-auto ${group.status === 'Terminated' ? 'bg-blue-50' : ''}`}>
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="Active">進行中</SelectItem>
                                                    <SelectItem value="Terminated">已終止</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                )}
            </DialogContent>
        </Dialog>
    );
}
