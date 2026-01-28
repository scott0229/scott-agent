'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Loader2, Users, TrendingUp, BarChart3, ChevronUp, ChevronDown } from "lucide-react";
import { useYearFilter } from '@/contexts/YearFilterContext';
import { OptionsClientSkeleton } from '@/components/LoadingSkeletons';
import { UserAnalysisPanel } from '@/components/UserAnalysisPanel';
import { OptionsSummaryPanel } from '@/components/OptionsSummaryPanel';
import { useWindowSize } from '@/hooks/use-window-size';

interface UserStats {
    month: string;
    total_profit: number;
    put_profit: number;
    call_profit: number;
    turnover?: number;
}

interface User {
    id: number;
    user_id: string;
    email: string;
    avatar_url: string | null;
    ib_account: string | null;
    options_count: number;
    open_count: number;
    monthly_stats?: UserStats[];
    total_profit?: number;
    net_deposit?: number;
    initial_cost?: number;
    open_put_covered_capital?: number;
}

export default function OptionsPage() {
    const [clients, setClients] = useState<User[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [mounted, setMounted] = useState(false);
    const { selectedYear } = useYearFilter();

    // Changed: Track expanded user ID for inline display instead of dialog
    const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

    const [sortOrder, setSortOrder] = useState('profit-desc');
    const router = useRouter();

    // Use window size for responsive grid calculation
    const { width } = useWindowSize();

    // Ref for auto-scrolling to analysis panel
    const analysisPanelRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to analysis panel when expanded
    useEffect(() => {
        if (expandedUserId && analysisPanelRef.current) {
            setTimeout(() => {
                analysisPanelRef.current?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center'
                });
            }, 150);
        }
    }, [expandedUserId]);

    const checkUserAndFetchClients = async () => {
        try {
            // 1. Check current user role
            const authRes = await fetch('/api/auth/me', { cache: 'no-store' });
            if (authRes.ok) {
                const authData = await authRes.json();
                console.log('Options Check Role:', authData.user);
                if (authData.user && authData.user.role === 'customer') {
                    // Redirect customer to their own page
                    // Prefer user_id (string), fallback to id (number) if user_id is null
                    const targetId = authData.user.user_id || authData.user.id;
                    router.replace(`/options/${targetId}`);
                    return; // Stop execution
                }
            }

            // 2. If not customer (admin/trader), fetch clients filtered by year
            const year = selectedYear === 'All' ? new Date().getFullYear() : selectedYear;
            const res = await fetch(`/api/users?mode=selection&roles=customer&year=${year}`, {
                cache: 'no-store'
            });
            const data = await res.json();
            if (data.users) {
                setClients(data.users);
            }
        } catch (error) {
            console.error('Failed to init options page:', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        checkUserAndFetchClients();
    }, [router, selectedYear]); // Add selectedYear dependency

    useEffect(() => {
        setMounted(true);
    }, []);

    // Helper to determine number of columns based on window width
    // Tailwind breakpoints: md: 768px (2 cols), lg: 1024px (3 cols)
    const getNumColumns = () => {
        if (!width) return 1; // Default
        if (width >= 1024) return 3;
        if (width >= 768) return 2;
        return 1;
    };

    if (isLoading) {
        return (
            <div className="container mx-auto py-10 max-w-[1200px]">
                <div className="mb-8 flex justify-between items-center">
                    <h1 className="text-3xl font-bold">
                        {mounted ? (selectedYear === 'All' ? new Date().getFullYear() : selectedYear) : ''} 期權交易
                    </h1>
                </div>
                <OptionsClientSkeleton />
            </div>
        );
    }

    const sortedClients = [...clients].sort((a, b) => {
        if (sortOrder === 'alphabetical') {
            const nameA = a.user_id || a.email;
            const nameB = b.user_id || b.email;
            return nameA.localeCompare(nameB);
        } else if (sortOrder === 'profit-desc') {
            const equityA = (a.initial_cost || 0) + (a.net_deposit || 0) + (a.total_profit || 0);
            const equityB = (b.initial_cost || 0) + (b.net_deposit || 0) + (b.total_profit || 0);
            return equityB - equityA;
        } else if (sortOrder === 'margin-desc') {
            const equityA = (a.initial_cost || 0) + (a.net_deposit || 0) + (a.total_profit || 0);
            const marginRateA = equityA > 0 ? (a.open_put_covered_capital || 0) / equityA : 0;

            const equityB = (b.initial_cost || 0) + (b.net_deposit || 0) + (b.total_profit || 0);
            const marginRateB = equityB > 0 ? (b.open_put_covered_capital || 0) / equityB : 0;

            return marginRateB - marginRateA;
        }
        return 0;
    });

    // Logic to insert the expanded panel
    const numColumns = getNumColumns();
    const clientsWithPanel = [];

    // Find index of expanded user
    const expandedIndex = sortedClients.findIndex(c =>
        (c.user_id || c.email) === expandedUserId
    );

    // If expanded, calculate where to insert the panel (end of the row)
    let insertPanelAtIndex = -1;
    if (expandedIndex !== -1) {
        const rowStartIndex = Math.floor(expandedIndex / numColumns) * numColumns;
        // The end of the row is start index + columns - 1, but we need to verify limits
        const rowEndIndex = Math.min(rowStartIndex + numColumns - 1, sortedClients.length - 1);
        insertPanelAtIndex = rowEndIndex;
    }

    // Build the render list
    for (let i = 0; i < sortedClients.length; i++) {
        clientsWithPanel.push({ type: 'card', data: sortedClients[i] });
        if (i === insertPanelAtIndex) {
            clientsWithPanel.push({
                type: 'panel',
                data: sortedClients[expandedIndex]
            });
        }
    }

    return (
        <div className="container mx-auto py-10 max-w-[1200px]">
            <div className="mb-8 flex justify-between items-center">
                <h1 className="text-3xl font-bold">
                    {mounted ? (selectedYear === 'All' ? new Date().getFullYear() : selectedYear) : ''} 期權交易
                </h1>
                <Select value={sortOrder} onValueChange={setSortOrder}>
                    <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="排序方式" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="alphabetical">按字母</SelectItem>
                        <SelectItem value="profit-desc">當前淨值-從大到小</SelectItem>
                        <SelectItem value="margin-desc">融資需求-從高到低</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {/* Summary Panel */}
            {sortedClients.length > 0 && (
                <OptionsSummaryPanel users={sortedClients} year={selectedYear} />
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {clientsWithPanel.map((item, index) => {
                    if (item.type === 'panel') {
                        // Full width panel that spans all columns
                        return (
                            <div ref={analysisPanelRef} key="analysis-panel" className="col-span-1 md:col-span-2 lg:col-span-3 animate-in fade-in slide-in-from-top-4 duration-300">
                                <UserAnalysisPanel
                                    user={item.data}
                                    year={selectedYear.toString()}
                                />
                            </div>
                        );
                    }

                    const client = item.data;
                    const displayName = client.user_id || client.email.split('@')[0];
                    const initials = displayName.charAt(0).toUpperCase();
                    const isExpanded = (client.user_id || client.email) === expandedUserId;

                    return (
                        <Card
                            key={client.id}
                            className={`hover:shadow-lg transition-all hover:border-primary/50 relative ${isExpanded ? 'border-primary ring-1 ring-primary' : ''}`}
                        >
                            {/* Triangle indicator for selected card */}
                            {isExpanded && (
                                <div className="absolute -bottom-[10px] left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-t-[10px] border-t-primary z-10"></div>
                            )}

                            <CardHeader className="flex flex-row items-center gap-4 pb-0">
                                <Avatar className="h-12 w-12 border-2 border-transparent group-hover:border-primary transition-colors">
                                    <AvatarImage src={client.avatar_url || undefined} />
                                    <AvatarFallback>{initials}</AvatarFallback>
                                </Avatar>
                                <div className="flex flex-col overflow-hidden">
                                    <CardTitle className="text-lg truncate">
                                        {displayName}{client.ib_account ? <span className="text-muted-foreground text-sm"> - {client.ib_account}</span> : ''}
                                    </CardTitle>
                                    <CardDescription className="truncate flex items-center mt-1">
                                        <span
                                            className="bg-red-50 text-red-600 px-2.5 py-0.5 rounded-full text-xs font-medium border border-red-200 mr-1.5 cursor-pointer hover:bg-red-100 transition-colors"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                router.push(`/options/${client.user_id || client.id}?status=${encodeURIComponent('未平倉')}`);
                                            }}
                                        >
                                            {client.open_count || 0}
                                        </span>
                                        筆未平倉
                                    </CardDescription>
                                </div>
                            </CardHeader>
                            <CardContent className="-mt-2">
                                {client.monthly_stats && client.monthly_stats.length > 0 ? (
                                    <div>
                                        <div className="border rounded-md overflow-hidden mb-4">
                                            {(() => {
                                                const currentMonth = new Date().getMonth() + 1; // 1-12
                                                const currentQuarter = Math.ceil(currentMonth / 3);

                                                // Calculate Quarterly Profit
                                                const startMonth = (currentQuarter - 1) * 3 + 1;
                                                const endMonth = startMonth + 2;

                                                const quarterProfit = client.monthly_stats
                                                    .filter((stat: any) => {
                                                        const m = parseInt(stat.month.replace('月', ''));
                                                        return m >= startMonth && m <= endMonth;
                                                    })
                                                    .reduce((sum: number, stat: any) => sum + stat.total_profit, 0);

                                                const yearProfit = client.total_profit || 0;

                                                // Calculate Current Net Equity and Annual Target
                                                const currentEquity = (client.initial_cost || 0) + (client.net_deposit || 0) + (client.total_profit || 0);
                                                const annualTarget = Math.round(currentEquity * 0.04);
                                                const quarterTarget = Math.round(annualTarget / 4);

                                                const displayYear = selectedYear === 'All' ? new Date().getFullYear() : selectedYear;

                                                // Calculate Margin Requirement Rate (融資需求率)
                                                // Formula: Sum(Open PUT Strike * Quantity * 100) / Current Net Equity
                                                const marginRate = currentEquity > 0
                                                    ? (client.open_put_covered_capital || 0) / currentEquity
                                                    : 0;
                                                const marginRateDisplay = (marginRate * 100).toFixed(0) + '%';

                                                // Calculate Monthly Capital Turnover Rate (月資金流水率)
                                                // Formula: (Current Net Equity * Days in Month) / Monthly Turnover
                                                // Monthly Turnover is calculated in backend as Sum(Collateral * Days Held) for the current month.
                                                // We need to find the stats for the current month.
                                                const currentMonthStr = new Date().getMonth() + 1; // 1-indexed (e.g., 1 for Jan)
                                                const currentMonthStats = client.monthly_stats?.find((s) => parseInt(s.month) === currentMonthStr);
                                                const monthlyTurnover = currentMonthStats?.turnover || 0;
                                                const daysInCurrentMonth = new Date(new Date().getFullYear(), currentMonthStr, 0).getDate();

                                                const turnoverRate = (currentEquity * daysInCurrentMonth) > 0
                                                    ? monthlyTurnover / (currentEquity * daysInCurrentMonth)
                                                    : 0;
                                                const turnoverRateDisplay = (turnoverRate * 100).toFixed(0) + '%';

                                                const metrics = [
                                                    {
                                                        label: '融資需求率',
                                                        value: <span className="bg-amber-50 text-amber-900 px-2.5 py-0.5 rounded-full text-xs font-medium border border-amber-200">{marginRateDisplay}</span>
                                                    },
                                                    {
                                                        label: '月資金流水率',
                                                        value: <span className="bg-amber-50 text-amber-900 px-2.5 py-0.5 rounded-full text-xs font-medium border border-amber-200">{turnoverRateDisplay}</span>
                                                    },
                                                    {
                                                        label: `權利金-Q${currentQuarter}`,
                                                        value: <span className="bg-amber-50 text-amber-900 px-2.5 py-0.5 rounded-full text-xs font-medium border border-amber-200">{quarterProfit.toLocaleString()}</span>
                                                    },
                                                    { label: `權利金-Q${currentQuarter}-目標`, value: quarterTarget.toLocaleString() },
                                                    {
                                                        label: `權利金-${displayYear}`,
                                                        value: <span className="bg-amber-50 text-amber-900 px-2.5 py-0.5 rounded-full text-xs font-medium border border-amber-200">{yearProfit.toLocaleString()}</span>
                                                    },
                                                    { label: `權利金-${displayYear}-目標`, value: annualTarget.toLocaleString() },
                                                ];

                                                return (
                                                    <div className="bg-white">
                                                        {metrics.map((metric, idx) => (
                                                            <div
                                                                key={idx}
                                                                className={`flex justify-between items-center px-3 py-1.5 text-[13px] ${idx !== metrics.length - 1 ? 'border-b' : ''}`}
                                                            >
                                                                <span className="font-medium text-gray-900">{metric.label}</span>
                                                                <span className="text-gray-600 font-medium">{metric.value}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                );
                                            })()}
                                        </div>

                                        <div className="border rounded-md overflow-hidden">
                                            {/* Header Table */}
                                            <div className="bg-muted border-b">
                                                <table className="w-full text-[13px] table-fixed">
                                                    <colgroup>
                                                        <col className="w-[25%]" />
                                                        <col className="w-[25%]" />
                                                        <col className="w-[25%]" />
                                                        <col className="w-[25%]" />
                                                    </colgroup>
                                                    <thead>
                                                        <tr className="text-[13px] font-medium text-muted-foreground bg-[#e8e4dc]">
                                                            <th className="text-center h-7 px-2 py-1.5 font-medium text-foreground"></th>
                                                            <th className="text-center h-7 px-2 py-1.5 font-medium text-foreground">總損益</th>
                                                            <th className="text-center h-7 px-2 py-1.5 font-medium text-foreground">PUT</th>
                                                            <th className="text-center h-7 px-2 py-1.5 font-medium text-foreground">CALL</th>
                                                        </tr>
                                                    </thead>
                                                </table>
                                            </div>

                                            {/* Scrollable Body Table */}
                                            <div className="max-h-[200px] overflow-y-auto relative bg-white [&::-webkit-scrollbar]:!w-[2px]">
                                                <table className="w-full text-[13px] table-fixed">
                                                    <colgroup>
                                                        <col className="w-[25%]" />
                                                        <col className="w-[25%]" />
                                                        <col className="w-[25%]" />
                                                        <col className="w-[25%]" />
                                                    </colgroup>
                                                    <tbody className="text-[13px]">
                                                        {client.monthly_stats.map((stat, index) => (
                                                            <tr key={stat.month} className={`border-b border-border/50 hover:bg-secondary/20 ${index % 2 === 0 ? 'bg-slate-50/50' : 'bg-white'}`}>
                                                                <td className="px-2 text-center h-7">{stat.month}月</td>
                                                                <td className="px-2 text-center h-7">
                                                                    {stat.total_profit.toLocaleString()}
                                                                </td>
                                                                <td className="px-2 text-center h-7">
                                                                    {stat.put_profit.toLocaleString()}
                                                                </td>
                                                                <td className="px-2 text-center h-7">
                                                                    {stat.call_profit.toLocaleString()}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>

                                            {/* Footer Table */}
                                            <div className="bg-muted border-t">
                                                <table className="w-full text-[13px] table-fixed">
                                                    <colgroup>
                                                        <col className="w-[25%]" />
                                                        <col className="w-[25%]" />
                                                        <col className="w-[25%]" />
                                                        <col className="w-[25%]" />
                                                    </colgroup>
                                                    <tbody>
                                                        <tr>
                                                            <td className="px-2 text-center h-7"></td>
                                                            <td className="px-2 text-center h-7">
                                                                {(client.total_profit ?? 0).toLocaleString()}
                                                            </td>
                                                            <td className="px-2 text-center h-7">
                                                                {client.monthly_stats.reduce((sum, s) => sum + s.put_profit, 0).toLocaleString()}
                                                            </td>
                                                            <td className="px-2 text-center h-7">
                                                                {client.monthly_stats.reduce((sum, s) => sum + s.call_profit, 0).toLocaleString()}
                                                            </td>
                                                        </tr>
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="text-sm text-muted-foreground mt-2">
                                        查看{client.options_count || 0}筆交易記錄 &rarr;
                                    </div>
                                )}
                                <div className="flex gap-2 mt-3">
                                    <Button
                                        variant="outline"
                                        onClick={() => router.push(`/options/${client.user_id || client.id}`)}
                                        className="flex-1 justify-center gap-2 px-3"
                                        size="sm"
                                    >
                                        <span>交易記錄</span>
                                        <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full text-xs font-medium border border-gray-200">
                                            {client.options_count || 0}
                                        </span>
                                    </Button>
                                    <Button
                                        variant={isExpanded ? "default" : "outline"}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            const id = client.user_id || client.email;
                                            setExpandedUserId(expandedUserId === id ? null : id);
                                        }}
                                        className="flex-1"
                                        size="sm"
                                    >
                                        <BarChart3 className="h-4 w-4 mr-1" />
                                        數據分析
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    );
                })}

                {clients.length === 0 && (
                    <div className="col-span-full text-center py-12 text-muted-foreground bg-secondary/10 rounded-lg border border-dashed">
                        尚無客戶資料
                    </div>
                )}
            </div>

        </div>
    );
}
