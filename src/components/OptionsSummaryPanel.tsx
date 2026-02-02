import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Eye, EyeOff, RotateCcw, Save } from 'lucide-react';

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

interface OptionsSummaryPanelProps {
    users: User[];
    year: string | number;
}

export function OptionsSummaryPanel({ users, year }: OptionsSummaryPanelProps) {
    if (!users || users.length === 0) return null;

    // Column visibility state
    const [columnVisibility, setColumnVisibility] = useState<{
        allUsers: boolean;
        users: Record<string, boolean>;
    }>({
        allUsers: true,
        users: {}
    });
    const [hasSavedSettings, setHasSavedSettings] = useState(false);

    // Initialize user visibility on mount
    useEffect(() => {
        const savedSetting = localStorage.getItem('optionsSummaryColumnVisibility');
        if (savedSetting !== null) {
            try {
                const parsed = JSON.parse(savedSetting);
                setColumnVisibility(parsed);
                setHasSavedSettings(true);
            } catch (e) {
                // If parsing fails, use default
                const defaultVisibility = {
                    allUsers: true,
                    users: users.reduce((acc, user) => {
                        acc[user.user_id || user.id.toString()] = true;
                        return acc;
                    }, {} as Record<string, boolean>)
                };
                setColumnVisibility(defaultVisibility);
            }
        } else {
            // Initialize all users as visible
            const defaultVisibility = {
                allUsers: true,
                users: users.reduce((acc, user) => {
                    acc[user.user_id || user.id.toString()] = true;
                    return acc;
                }, {} as Record<string, boolean>)
            };
            setColumnVisibility(defaultVisibility);
        }
    }, [users]);

    // Toggle column visibility
    const toggleColumn = (columnKey: string) => {
        setColumnVisibility(prev => {
            if (columnKey === 'allUsers') {
                return { ...prev, allUsers: !prev.allUsers };
            } else {
                return {
                    ...prev,
                    users: { ...prev.users, [columnKey]: !prev.users[columnKey] }
                };
            }
        });
    };

    // Reset visibility to default (show all)
    const resetVisibility = () => {
        const defaultVisibility = {
            allUsers: true,
            users: users.reduce((acc, user) => {
                acc[user.user_id || user.id.toString()] = true;
                return acc;
            }, {} as Record<string, boolean>)
        };
        setColumnVisibility(defaultVisibility);
        localStorage.removeItem('optionsSummaryColumnVisibility');
        setHasSavedSettings(false);
    };

    // Save current visibility state
    const saveVisibility = () => {
        localStorage.setItem('optionsSummaryColumnVisibility', JSON.stringify(columnVisibility));
        setHasSavedSettings(true);
    };

    // --- Helpers ---
    const formatMoney = (val: number) => new Intl.NumberFormat('en-US').format(Math.round(val));
    const formatPercent = (val: number) => `${(val * 100).toFixed(0)}%`;

    const currentMonthStr = new Date().getMonth() + 1; // 1-12
    const daysInCurrentMonth = new Date(new Date().getFullYear(), currentMonthStr, 0).getDate();
    const currentQuarter = Math.ceil(currentMonthStr / 3);
    const startMonth = (currentQuarter - 1) * 3 + 1;
    const endMonth = startMonth + 2;

    const calculateUserMetrics = (user: User) => {
        const equity = (user.initial_cost || 0) + (user.net_deposit || 0) + (user.total_profit || 0);

        // Margin Rate
        const marginRate = equity > 0 ? (user.open_put_covered_capital || 0) / equity : 0;

        // Turnover Rate
        const currentMonthStats = user.monthly_stats?.find((s) => parseInt(s.month.replace('月', '')) === currentMonthStr);
        const monthlyTurnover = currentMonthStats?.turnover || 0;
        const turnoverRate = (equity * daysInCurrentMonth) > 0 ? monthlyTurnover / (equity * daysInCurrentMonth) : 0;

        // QX Premium
        const quarterPremium = user.monthly_stats?.filter((stat) => {
            const m = parseInt(stat.month.replace('月', ''));
            return m >= startMonth && m <= endMonth;
        }).reduce((s, stat) => s + stat.total_profit, 0) || 0;

        // QX Target
        const annualTarget = Math.round(equity * 0.04);
        const quarterTarget = Math.round(annualTarget / 4);

        // Annual Premium
        const annualPremium = user.total_profit || 0;

        return {
            marginRate,
            turnoverRate,
            quarterPremium,
            quarterTarget,
            annualPremium,
            annualTarget
        };
    };

    // Calculate Aggregates
    const totalNetEquity = users.reduce((sum, user) => sum + (user.initial_cost || 0) + (user.net_deposit || 0) + (user.total_profit || 0), 0);
    const totalOpenPutCapital = users.reduce((sum, user) => sum + (user.open_put_covered_capital || 0), 0);
    const aggregateMarginRate = totalNetEquity > 0 ? totalOpenPutCapital / totalNetEquity : 0;
    const totalOpenCount = users.reduce((sum, user) => sum + (user.open_count || 0), 0);

    const totalMonthlyTurnover = users.reduce((sum, user) => {
        const currentMonthStats = user.monthly_stats?.find((s) => parseInt(s.month.replace('月', '')) === currentMonthStr);
        return sum + (currentMonthStats?.turnover || 0);
    }, 0);
    const aggregateTurnoverRate = (totalNetEquity * daysInCurrentMonth) > 0 ? totalMonthlyTurnover / (totalNetEquity * daysInCurrentMonth) : 0;

    const totalQuarterPremium = users.reduce((sum, user) => sum + calculateUserMetrics(user).quarterPremium, 0);
    const totalQuarterTarget = users.reduce((sum, user) => sum + calculateUserMetrics(user).quarterTarget, 0);
    const totalAnnualPremium = users.reduce((sum, user) => sum + (user.total_profit || 0), 0);
    const totalAnnualTarget = users.reduce((sum, user) => sum + calculateUserMetrics(user).annualTarget, 0);

    const aggregates = {
        marginRate: aggregateMarginRate,
        turnoverRate: aggregateTurnoverRate,
        quarterPremium: totalQuarterPremium,
        quarterTarget: totalQuarterTarget,
        annualPremium: totalAnnualPremium,
        annualTarget: totalAnnualTarget
    };



    // --- Badge Component ---
    const StatBadge = ({ children }: { children: React.ReactNode }) => (
        <span className="inline-flex items-center justify-center rounded-full border px-2.5 py-0.5 text-xs font-medium bg-[#FFF9E5] text-[#78350F] border-[#FCD34D]">
            {children}
        </span>
    );

    const displayYear = year === 'All' ? new Date().getFullYear() : year;

    return (
        <div className="rounded-md border bg-white mb-8 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
                <table className="w-full text-[13px] table-auto">
                    <colgroup>
                        <col className="w-[180px]" /> {/* Label Column */}
                        {columnVisibility.allUsers && <col className="w-[140px]" />} {/* All Users Column */}
                        {users.map(u => {
                            const userKey = u.user_id || u.id.toString();
                            const isVisible = columnVisibility.users[userKey] !== false;
                            return isVisible ? <col key={u.id} className="w-[120px]" /> : null;
                        })}
                    </colgroup>
                    <thead>
                        <tr className="border-b bg-muted/40 text-[13px] font-medium">
                            <td className="py-1 px-2 sticky left-0 bg-muted/40 z-10 border-r whitespace-nowrap">
                                <div className="flex items-center gap-1.5">
                                    <button
                                        onClick={resetVisibility}
                                        className="inline-flex items-center justify-center w-6 h-6 text-slate-700 hover:text-slate-900 hover:bg-white rounded transition-colors cursor-pointer"
                                        title="重置隱藏"
                                    >
                                        <RotateCcw className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={saveVisibility}
                                        className={`inline-flex items-center justify-center w-6 h-6 rounded transition-colors cursor-pointer ${hasSavedSettings
                                            ? 'text-red-600 hover:text-red-700 hover:bg-red-50'
                                            : 'text-slate-700 hover:text-slate-900 hover:bg-white'
                                            }`}
                                        title={hasSavedSettings ? "已記憶隱藏設定" : "記憶隱藏"}
                                    >
                                        <Save className="w-4 h-4" />
                                    </button>
                                </div>
                            </td>
                            {columnVisibility.allUsers && (
                                <td className="text-center px-2 py-1 bg-muted/40 text-foreground border-r">
                                    <div className="inline-flex items-center gap-0">
                                        <span>全體用戶</span>
                                        <button
                                            onClick={() => toggleColumn('allUsers')}
                                            className="inline-flex items-center justify-center w-4 h-4 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                                            title={columnVisibility.allUsers ? "隱藏此列" : "顯示此列"}
                                        >
                                            {columnVisibility.allUsers ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                                        </button>
                                    </div>
                                </td>
                            )}
                            {users.map(user => {
                                const userKey = user.user_id || user.id.toString();
                                const isVisible = columnVisibility.users[userKey] !== false;

                                return isVisible ? (
                                    <td key={user.id} className="text-center px-2 py-1 bg-muted/40 text-foreground">
                                        <div className="inline-flex items-center gap-0">
                                            <Link
                                                href={`/options/${user.user_id || user.id}`}
                                                className="inline-flex items-center justify-center gap-1.5 px-2 py-0.5 rounded-md hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                                            >
                                                <div className="h-2 w-2 rounded-full bg-blue-600" />
                                                <span>{user.user_id || user.email.split('@')[0]}</span>
                                            </Link>
                                            <button
                                                onClick={() => toggleColumn(userKey)}
                                                className="inline-flex items-center justify-center w-4 h-4 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                                                title={isVisible ? "隱藏此列" : "顯示此列"}
                                            >
                                                {isVisible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                                            </button>
                                        </div>
                                    </td>
                                ) : null;
                            })}
                        </tr>
                    </thead>
                    <tbody className="text-[13px]">
                        {/* Margin Rate */}
                        <tr className="border-t hover:bg-secondary/20 bg-white">
                            <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-white z-10 border-r whitespace-nowrap">融資需求率</td>
                            {columnVisibility.allUsers && (
                                <td className="h-7 py-1 px-2 text-center border-r bg-slate-50/50">
                                    <StatBadge>{formatPercent(aggregates.marginRate)}</StatBadge>
                                </td>
                            )}
                            {users.map(user => {
                                const userKey = user.user_id || user.id.toString();
                                const isVisible = columnVisibility.users[userKey] !== false;
                                return isVisible ? (
                                    <td key={user.id} className="h-7 py-1 px-2 text-center">
                                        <StatBadge>{formatPercent(calculateUserMetrics(user).marginRate)}</StatBadge>
                                    </td>
                                ) : null;
                            })}
                        </tr>
                        {/* Turnover Rate */}
                        <tr className="border-t hover:bg-secondary/20 bg-slate-50/50">
                            <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-slate-50/50 z-10 border-r whitespace-nowrap">月資金流水率</td>
                            {columnVisibility.allUsers && (
                                <td className="h-7 py-1 px-2 text-center border-r bg-slate-100/50">
                                    {formatPercent(aggregates.turnoverRate)}
                                </td>
                            )}
                            {users.map(user => {
                                const userKey = user.user_id || user.id.toString();
                                const isVisible = columnVisibility.users[userKey] !== false;
                                return isVisible ? (
                                    <td key={user.id} className="h-7 py-1 px-2 text-center">
                                        {formatPercent(calculateUserMetrics(user).turnoverRate)}
                                    </td>
                                ) : null;
                            })}
                        </tr>
                        {/* Quarterly Premium */}
                        <tr className="border-t hover:bg-secondary/20 bg-white">
                            <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-white z-10 border-r whitespace-nowrap">權利金-Q{currentQuarter}</td>
                            {columnVisibility.allUsers && (
                                <td className="h-7 py-1 px-2 text-center border-r bg-slate-50/50">
                                    <StatBadge>{formatMoney(aggregates.quarterPremium)}</StatBadge>
                                </td>
                            )}
                            {users.map(user => {
                                const userKey = user.user_id || user.id.toString();
                                const isVisible = columnVisibility.users[userKey] !== false;
                                return isVisible ? (
                                    <td key={user.id} className="h-7 py-1 px-2 text-center">
                                        <StatBadge>{formatMoney(calculateUserMetrics(user).quarterPremium)}</StatBadge>
                                    </td>
                                ) : null;
                            })}
                        </tr>
                        {/* Quarterly Target */}
                        <tr className="border-t hover:bg-secondary/20 bg-slate-50/50">
                            <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-slate-50/50 z-10 border-r whitespace-nowrap">權利金-Q{currentQuarter}-目標</td>
                            {columnVisibility.allUsers && (
                                <td className="h-7 py-1 px-2 text-center border-r bg-slate-100/50">
                                    {formatMoney(aggregates.quarterTarget)}
                                </td>
                            )}
                            {users.map(user => {
                                const userKey = user.user_id || user.id.toString();
                                const isVisible = columnVisibility.users[userKey] !== false;
                                return isVisible ? (
                                    <td key={user.id} className="h-7 py-1 px-2 text-center">
                                        {formatMoney(calculateUserMetrics(user).quarterTarget)}
                                    </td>
                                ) : null;
                            })}
                        </tr>
                        {/* Annual Premium */}
                        <tr className="border-t hover:bg-secondary/20 bg-white">
                            <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-white z-10 border-r whitespace-nowrap">權利金-{displayYear}</td>
                            {columnVisibility.allUsers && (
                                <td className="h-7 py-1 px-2 text-center border-r bg-slate-50/50">
                                    {formatMoney(aggregates.annualPremium)}
                                </td>
                            )}
                            {users.map(user => {
                                const userKey = user.user_id || user.id.toString();
                                const isVisible = columnVisibility.users[userKey] !== false;
                                return isVisible ? (
                                    <td key={user.id} className="h-7 py-1 px-2 text-center">
                                        {formatMoney(calculateUserMetrics(user).annualPremium)}
                                    </td>
                                ) : null;
                            })}
                        </tr>
                        {/* Annual Target */}
                        <tr className="border-t hover:bg-secondary/20 bg-slate-50/50">
                            <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-slate-50/50 z-10 border-r whitespace-nowrap">權利金-{displayYear}-目標</td>
                            {columnVisibility.allUsers && (
                                <td className="h-7 py-1 px-2 text-center border-r bg-slate-100/50">
                                    {formatMoney(aggregates.annualTarget)}
                                </td>
                            )}
                            {users.map(user => {
                                const userKey = user.user_id || user.id.toString();
                                const isVisible = columnVisibility.users[userKey] !== false;
                                return isVisible ? (
                                    <td key={user.id} className="h-7 py-1 px-2 text-center">
                                        {formatMoney(calculateUserMetrics(user).annualTarget)}
                                    </td>
                                ) : null;
                            })}
                        </tr>
                        {/* Open Position Count */}
                        <tr className="border-t hover:bg-secondary/20 bg-white">
                            <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-white z-10 border-r whitespace-nowrap">新開倉數</td>
                            {columnVisibility.allUsers && (
                                <td className="h-7 py-1 px-2 text-center border-r bg-slate-50/50">
                                    <Link
                                        href={`/options/All?operation=${encodeURIComponent('持有中')}`}
                                        className="cursor-pointer"
                                    >
                                        <span className="inline-flex items-center justify-center min-w-[1.5rem] px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 hover:border-red-300 transition-colors">
                                            {totalOpenCount}
                                        </span>
                                    </Link>
                                </td>
                            )}
                            {users.map(user => {
                                const userKey = user.user_id || user.id.toString();
                                const isVisible = columnVisibility.users[userKey] !== false;
                                return isVisible ? (
                                    <td key={user.id} className="h-7 py-1 px-2 text-center">
                                        <Link
                                            href={`/options/${user.user_id || user.id}?operation=${encodeURIComponent('持有中')}`}
                                            className="cursor-pointer"
                                        >
                                            <span className="inline-flex items-center justify-center min-w-[1.5rem] px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 hover:border-red-300 transition-colors">
                                                {user.open_count || 0}
                                            </span>
                                        </Link>
                                    </td>
                                ) : null;
                            })}
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    );
}
