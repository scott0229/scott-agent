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
    put_win_rate: number | null;
    call_win_rate: number | null;
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
    current_cash_balance?: number;
    last_update_date?: number;
}

export default function OptionsPage() {
    const [clients, setClients] = useState<User[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [mounted, setMounted] = useState(false);
    const { selectedYear } = useYearFilter();

    // Changed: Track expanded user ID for inline display instead of dialog
    const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

    const [sortOrder, setSortOrder] = useState('margin-desc');
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
        if (width >= 1024) return 2;
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {clientsWithPanel.map((item, index) => {
                    if (item.type === 'panel') {
                        // Full width panel that spans all columns
                        return (
                            <div ref={analysisPanelRef} key="analysis-panel" className="col-span-1 md:col-span-2 animate-in fade-in slide-in-from-top-4 duration-300">
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
                        <div
                            key={client.id}
                        >
                            {client.monthly_stats && client.monthly_stats.length > 0 ? (
                                <div>

                                    <div className="border rounded-md overflow-hidden">
                                        {/* Header Table */}
                                        <div className="bg-muted/40 border-b">
                                            <table className="w-full text-[13px] table-fixed">
                                                <colgroup>
                                                    <col className="w-[16%]" />
                                                    <col className="w-[12%]" />
                                                    <col className="w-[12%]" />
                                                    <col className="w-[12%]" />
                                                    <col className="w-[12%]" />
                                                    <col className="w-[12%]" />
                                                    <col className="w-[12%]" />
                                                </colgroup>
                                                <thead>
                                                    <tr className="text-[13px] font-medium text-muted-foreground bg-muted/40">
                                                        <th className="text-center h-7 px-1 py-1.5 font-medium text-foreground">
                                                            <span className="bg-primary/10 text-foreground px-2 py-0.5 rounded font-semibold text-sm inline-flex items-center gap-1.5">
                                                                <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block"></span>
                                                                {displayName}
                                                            </span>
                                                        </th>
                                                        <th className="text-center h-7 px-1 py-1.5 font-medium text-foreground">總損益</th>
                                                        <th className="text-center h-7 px-1 py-1.5 font-medium text-foreground">PUT</th>
                                                        <th className="text-center h-7 px-1 py-1.5 font-medium text-foreground">PUT勝率</th>
                                                        <th className="text-center h-7 px-1 py-1.5 font-medium text-foreground">CALL</th>
                                                        <th className="text-center h-7 px-1 py-1.5 font-medium text-foreground">CALL勝率</th>
                                                        <th className="text-center h-7 px-1 py-1.5 font-medium text-foreground">周轉率</th>
                                                    </tr>
                                                </thead>
                                            </table>
                                        </div>

                                        {/* Scrollable Body Table */}
                                        <div className="relative bg-white">
                                            <table className="w-full text-[13px] table-fixed">
                                                <colgroup>
                                                    <col className="w-[16%]" />
                                                    <col className="w-[12%]" />
                                                    <col className="w-[12%]" />
                                                    <col className="w-[12%]" />
                                                    <col className="w-[12%]" />
                                                    <col className="w-[12%]" />
                                                    <col className="w-[12%]" />
                                                </colgroup>
                                                <tbody className="text-[13px]">
                                                    {Array.from({ length: 12 }, (_, i) => {
                                                        const monthStr = String(i + 1).padStart(2, '0');
                                                        const stat = (client.monthly_stats || []).find(s => s.month === monthStr) || {
                                                            month: monthStr,
                                                            total_profit: 0,
                                                            put_profit: 0,
                                                            call_profit: 0,
                                                            put_win_rate: null,
                                                            call_win_rate: null,
                                                            turnover: 0
                                                        };
                                                        const index = i;
                                                        const initialCost = (client.initial_cost || 0) + (client.net_deposit || 0);
                                                        const monthNum = parseInt(stat.month);
                                                        const yearNum = typeof selectedYear === 'number' ? selectedYear : new Date().getFullYear();
                                                        const daysInMonth = new Date(yearNum, monthNum, 0).getDate();
                                                        const turnoverRate = (initialCost * daysInMonth) > 0 && stat.turnover ? stat.turnover / (initialCost * daysInMonth) : 0;
                                                        return (
                                                            <tr key={stat.month} className={`border-b border-border/50 hover:bg-secondary/20 ${index % 2 === 0 ? 'bg-slate-50/50' : 'bg-white'}`}>
                                                                <td className="px-1 text-center h-7">{stat.month}月</td>
                                                                <td className="px-1 text-center h-7">
                                                                    {Math.round(stat.total_profit).toLocaleString()}
                                                                </td>
                                                                <td className="px-1 text-center h-7">
                                                                    {Math.round(stat.put_profit).toLocaleString()}
                                                                </td>
                                                                <td className="px-1 text-center h-7">
                                                                    {stat.put_win_rate !== null ? `${stat.put_win_rate}%` : '-'}
                                                                </td>
                                                                <td className="px-1 text-center h-7">
                                                                    {Math.round(stat.call_profit).toLocaleString()}
                                                                </td>
                                                                <td className="px-1 text-center h-7">
                                                                    {stat.call_win_rate !== null ? `${stat.call_win_rate}%` : '-'}
                                                                </td>
                                                                <td className="px-1 text-center h-7">
                                                                    {turnoverRate > 0 ? `${(turnoverRate * 100).toFixed(0)}%` : '-'}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>

                                        {/* Footer Table */}
                                        <div className="bg-muted/40 border-t">
                                            <table className="w-full text-[13px] table-fixed">
                                                <colgroup>
                                                    <col className="w-[16%]" />
                                                    <col className="w-[12%]" />
                                                    <col className="w-[12%]" />
                                                    <col className="w-[12%]" />
                                                    <col className="w-[12%]" />
                                                    <col className="w-[12%]" />
                                                    <col className="w-[12%]" />
                                                </colgroup>
                                                <tbody>
                                                    <tr>
                                                        <td className="px-1 text-center h-7"></td>
                                                        <td className="px-1 text-center h-7">
                                                            {Math.round(client.total_profit ?? 0).toLocaleString()}
                                                        </td>
                                                        <td className="px-1 text-center h-7">
                                                            {Math.round(client.monthly_stats.reduce((sum, s) => sum + s.put_profit, 0)).toLocaleString()}
                                                        </td>
                                                        <td className="px-1 text-center h-7">
                                                            {(() => {
                                                                const stats = client.monthly_stats.filter(s => s.put_win_rate !== null);
                                                                if (stats.length === 0) return '-';
                                                                const avg = Math.round(stats.reduce((sum, s) => sum + (s.put_win_rate || 0), 0) / stats.length);
                                                                return `${avg}%`;
                                                            })()}
                                                        </td>
                                                        <td className="px-1 text-center h-7">
                                                            {Math.round(client.monthly_stats.reduce((sum, s) => sum + s.call_profit, 0)).toLocaleString()}
                                                        </td>
                                                        <td className="px-1 text-center h-7">
                                                            {(() => {
                                                                const stats = client.monthly_stats.filter(s => s.call_win_rate !== null);
                                                                if (stats.length === 0) return '-';
                                                                const avg = Math.round(stats.reduce((sum, s) => sum + (s.call_win_rate || 0), 0) / stats.length);
                                                                return `${avg}%`;
                                                            })()}
                                                        </td>
                                                        <td className="px-1 text-center h-7">
                                                            {(() => {
                                                                const initialCost = (client.initial_cost || 0) + (client.net_deposit || 0);
                                                                const monthsWithTurnover = client.monthly_stats.filter(s => (s.turnover || 0) > 0);
                                                                const totalTurnover = monthsWithTurnover.reduce((sum, s) => sum + (s.turnover || 0), 0);
                                                                const yearNum = typeof selectedYear === 'number' ? selectedYear : new Date().getFullYear();
                                                                const totalDays = monthsWithTurnover.reduce((sum, s) => {
                                                                    const monthNum = parseInt(s.month);
                                                                    return sum + new Date(yearNum, monthNum, 0).getDate();
                                                                }, 0);
                                                                const rate = (initialCost * totalDays) > 0 ? totalTurnover / (initialCost * totalDays) : 0;
                                                                return rate > 0 ? `${(rate * 100).toFixed(0)}%` : '-';
                                                            })()}
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

                        </div>
                    );
                })}

                {clients.length === 0 && (
                    <div className="col-span-full text-center py-12 text-muted-foreground bg-secondary/10 rounded-lg border border-dashed">
                        尚無客戶資料
                    </div>
                )}
            </div>

        </div >
    );
}
