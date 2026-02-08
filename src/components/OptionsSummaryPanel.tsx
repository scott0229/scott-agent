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
    active_count?: number;
    monthly_stats?: UserStats[];
    total_profit?: number;
    net_deposit?: number;
    initial_cost?: number;
    open_put_covered_capital?: number;
    current_cash_balance?: number;
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

        // Margin Rate: (Put Capital + Debt) / Equity
        const debt = Math.abs(Math.min(0, user.current_cash_balance || 0));
        const marginUsed = (user.open_put_covered_capital || 0) + debt;
        const marginRate = equity > 0 ? marginUsed / equity : 0;

        // Turnover Rate
        const currentMonthStats = user.monthly_stats?.find((s) => parseInt(s.month.replace('月', '')) === currentMonthStr);
        const monthlyTurnover = currentMonthStats?.turnover || 0;
        const turnoverRate = (equity * daysInCurrentMonth) > 0 ? monthlyTurnover / (equity * daysInCurrentMonth) : 0;

        // QX Premium
        const quarterStats = user.monthly_stats?.filter((stat) => {
            const m = parseInt(stat.month.replace('月', ''));
            return m >= startMonth && m <= endMonth;
        }) || [];

        const quarterPremium = quarterStats.reduce((s, stat) => s + stat.total_profit, 0);
        const quarterPutPremium = quarterStats.reduce((s, stat) => s + stat.put_profit, 0);
        const quarterCallPremium = quarterStats.reduce((s, stat) => s + stat.call_profit, 0);

        // QX Target - Use initial cost instead of current equity
        const initialCost = (user.initial_cost || 0) + (user.net_deposit || 0);
        const annualTarget = Math.round(initialCost * 0.04);
        const quarterTarget = Math.round(annualTarget / 4);

        // Annual Premium
        const annualPremium = user.total_profit || 0;
        const annualPutPremium = user.monthly_stats?.reduce((s, stat) => s + stat.put_profit, 0) || 0;
        const annualCallPremium = user.monthly_stats?.reduce((s, stat) => s + stat.call_profit, 0) || 0;

        return {
            marginRate,
            turnoverRate,
            quarterPremium,
            quarterPutPremium,
            quarterCallPremium,
            quarterTarget,
            annualPremium,
            annualPutPremium,
            annualCallPremium,
            annualTarget
        };
    };

    // Calculate Aggregates
    const totalNetEquity = users.reduce((sum, user) => sum + (user.initial_cost || 0) + (user.net_deposit || 0) + (user.total_profit || 0), 0);
    const totalOpenPutCapital = users.reduce((sum, user) => sum + (user.open_put_covered_capital || 0), 0);
    const totalDebt = users.reduce((sum, user) => sum + Math.abs(Math.min(0, user.current_cash_balance || 0)), 0);
    const aggregateMarginRate = totalNetEquity > 0 ? (totalOpenPutCapital + totalDebt) / totalNetEquity : 0;
    const totalOpenCount = users.reduce((sum, user) => sum + (user.open_count || 0), 0);
    const totalActiveCount = users.reduce((sum, user) => sum + (user.active_count || 0), 0);
    const totalOptionsCount = users.reduce((sum, user) => sum + (user.options_count || 0), 0);

    const totalMonthlyTurnover = users.reduce((sum, user) => {
        const currentMonthStats = user.monthly_stats?.find((s) => parseInt(s.month.replace('月', '')) === currentMonthStr);
        return sum + (currentMonthStats?.turnover || 0);
    }, 0);
    const aggregateTurnoverRate = (totalNetEquity * daysInCurrentMonth) > 0 ? totalMonthlyTurnover / (totalNetEquity * daysInCurrentMonth) : 0;

    const totalQuarterPremium = users.reduce((sum, user) => sum + calculateUserMetrics(user).quarterPremium, 0);
    const totalQuarterPutPremium = users.reduce((sum, user) => sum + calculateUserMetrics(user).quarterPutPremium, 0);
    const totalQuarterCallPremium = users.reduce((sum, user) => sum + calculateUserMetrics(user).quarterCallPremium, 0);
    const totalQuarterTarget = users.reduce((sum, user) => sum + calculateUserMetrics(user).quarterTarget, 0);
    const totalAnnualPremium = users.reduce((sum, user) => sum + (user.total_profit || 0), 0);
    const totalAnnualPutPremium = users.reduce((sum, user) => sum + calculateUserMetrics(user).annualPutPremium, 0);
    const totalAnnualCallPremium = users.reduce((sum, user) => sum + calculateUserMetrics(user).annualCallPremium, 0);
    const totalAnnualTarget = users.reduce((sum, user) => sum + calculateUserMetrics(user).annualTarget, 0);

    const aggregates = {
        marginRate: aggregateMarginRate,
        turnoverRate: aggregateTurnoverRate,
        quarterPremium: totalQuarterPremium,
        quarterPutPremium: totalQuarterPutPremium,
        quarterCallPremium: totalQuarterCallPremium,
        quarterTarget: totalQuarterTarget,
        annualPremium: totalAnnualPremium,
        annualPutPremium: totalAnnualPutPremium,
        annualCallPremium: totalAnnualCallPremium,
        annualTarget: totalAnnualTarget
    };



    // --- Badge Component ---
    const StatBadge = ({ children }: { children: React.ReactNode }) => (
        <span className="inline-flex items-center justify-center rounded-full border px-2.5 py-0.5 text-xs font-normal bg-[#FFF9E5] text-[#78350F] border-[#FCD34D]">
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
                                <td className="text-center px-2 py-1 bg-muted/40 text-foreground border-r whitespace-nowrap">
                                    <div className="inline-flex items-center gap-0">
                                        <button
                                            onClick={() => toggleColumn('allUsers')}
                                            className="inline-flex items-center justify-center w-5 h-5 text-blue-600 hover:text-blue-800 transition-colors cursor-pointer"
                                            title="隱藏此列"
                                        >
                                            <Eye className="w-3.5 h-3.5" />
                                        </button>
                                        <span className="font-bold">全體用戶</span>
                                    </div>
                                </td>
                            )}
                            {users.map(user => {
                                const userKey = user.user_id || user.id.toString();
                                const isVisible = columnVisibility.users[userKey] !== false;

                                return isVisible ? (
                                    <td key={user.id} className="text-center px-2 py-1 bg-muted/40 text-foreground">
                                        <div className="inline-flex items-center gap-0">
                                            <button
                                                onClick={() => toggleColumn(userKey)}
                                                className="inline-flex items-center justify-center w-5 h-5 text-blue-600 hover:text-blue-800 transition-colors cursor-pointer"
                                                title="隱藏此列"
                                            >
                                                <Eye className="w-3.5 h-3.5" />
                                            </button>
                                            <Link
                                                href={`/options/${user.user_id || user.id}`}
                                                className="inline-flex items-center justify-center px-1 py-0.5 rounded-md hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer font-bold"
                                            >
                                                {user.user_id || user.email.split('@')[0]}
                                            </Link>
                                        </div>
                                    </td>
                                ) : null;
                            })}
                        </tr>
                    </thead>
                    <tbody className="text-[13px]">
                        {/* Open Position Count */}
                        <tr className="border-t hover:bg-secondary/20 bg-white">
                            <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-white z-10 border-r whitespace-nowrap">開倉數</td>
                            {columnVisibility.allUsers && (
                                <td className="h-7 py-1 px-2 text-center border-r bg-slate-50/50">
                                    <div className="flex items-center justify-center gap-1">
                                        <Link
                                            href={`/options/All?year=All&operation=${encodeURIComponent('Open')}`}
                                            className="hover:text-primary transition-colors hover:underline decoration-2 underline-offset-4 font-medium text-red-600"
                                        >
                                            {totalActiveCount}
                                        </Link>
                                        <span className="text-muted-foreground">/</span>
                                        <Link
                                            href={`/options/All?year=${year === 'All' ? 'All' : year}`}
                                            className="hover:text-primary transition-colors hover:underline decoration-2 underline-offset-4 text-foreground"
                                        >
                                            {totalOptionsCount}
                                        </Link>
                                    </div>
                                </td>
                            )}
                            {users.map(user => {
                                const userKey = user.user_id || user.id.toString();
                                const isVisible = columnVisibility.users[userKey] !== false;
                                return isVisible ? (
                                    <td key={user.id} className="h-7 py-1 px-2 text-center">
                                        <div className="flex items-center justify-center gap-1">
                                            <Link
                                                href={`/options/${user.user_id || user.id}?year=All&operation=${encodeURIComponent('Open')}`}
                                                className="cursor-pointer text-red-600 hover:text-red-700 hover:underline decoration-2 underline-offset-4 text-xs font-medium transition-colors"
                                            >
                                                {user.active_count || 0}
                                            </Link>
                                            <span className="text-muted-foreground text-xs">/</span>
                                            <Link
                                                href={`/options/${user.user_id || user.id}?year=${year === 'All' ? 'All' : year}`}
                                                className="cursor-pointer hover:text-primary hover:underline decoration-2 underline-offset-4 text-xs text-foreground pl-0.5"
                                            >
                                                {user.options_count || 0}
                                            </Link>
                                        </div>
                                    </td>
                                ) : null;
                            })}
                        </tr>
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
                            <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-white z-10 border-r whitespace-nowrap">權利金-季</td>
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
                        {/* Quarterly Put Premium */}
                        <tr className="border-t hover:bg-secondary/20 bg-white">
                            <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-white z-10 border-r whitespace-nowrap">權利金-季-PUT</td>
                            {columnVisibility.allUsers && (
                                <td className="h-7 py-1 px-2 text-center border-r bg-slate-50/50">
                                    {formatMoney(aggregates.quarterPutPremium)}
                                </td>
                            )}
                            {users.map(user => {
                                const userKey = user.user_id || user.id.toString();
                                const isVisible = columnVisibility.users[userKey] !== false;
                                return isVisible ? (
                                    <td key={user.id} className="h-7 py-1 px-2 text-center">
                                        {formatMoney(calculateUserMetrics(user).quarterPutPremium)}
                                    </td>
                                ) : null;
                            })}
                        </tr>
                        {/* Quarterly Call Premium */}
                        <tr className="border-t hover:bg-secondary/20 bg-white">
                            <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-white z-10 border-r whitespace-nowrap">權利金-季-CALL</td>
                            {columnVisibility.allUsers && (
                                <td className="h-7 py-1 px-2 text-center border-r bg-slate-50/50">
                                    {formatMoney(aggregates.quarterCallPremium)}
                                </td>
                            )}
                            {users.map(user => {
                                const userKey = user.user_id || user.id.toString();
                                const isVisible = columnVisibility.users[userKey] !== false;
                                return isVisible ? (
                                    <td key={user.id} className="h-7 py-1 px-2 text-center">
                                        {formatMoney(calculateUserMetrics(user).quarterCallPremium)}
                                    </td>
                                ) : null;
                            })}
                        </tr>
                        {/* Quarterly Target */}
                        <tr className="border-t hover:bg-secondary/20 bg-slate-50/50">
                            <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-slate-50/50 z-10 border-r whitespace-nowrap">權利金-季-目標</td>
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
                            <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-white z-10 border-r whitespace-nowrap">權利金-年</td>
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
                        {/* Annual Put Premium */}
                        <tr className="border-t hover:bg-secondary/20 bg-white">
                            <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-white z-10 border-r whitespace-nowrap">權利金-年-PUT</td>
                            {columnVisibility.allUsers && (
                                <td className="h-7 py-1 px-2 text-center border-r bg-slate-50/50">
                                    {formatMoney(aggregates.annualPutPremium)}
                                </td>
                            )}
                            {users.map(user => {
                                const userKey = user.user_id || user.id.toString();
                                const isVisible = columnVisibility.users[userKey] !== false;
                                return isVisible ? (
                                    <td key={user.id} className="h-7 py-1 px-2 text-center">
                                        {formatMoney(calculateUserMetrics(user).annualPutPremium)}
                                    </td>
                                ) : null;
                            })}
                        </tr>
                        {/* Annual Call Premium */}
                        <tr className="border-t hover:bg-secondary/20 bg-white">
                            <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-white z-10 border-r whitespace-nowrap">權利金-年-CALL</td>
                            {columnVisibility.allUsers && (
                                <td className="h-7 py-1 px-2 text-center border-r bg-slate-50/50">
                                    {formatMoney(aggregates.annualCallPremium)}
                                </td>
                            )}
                            {users.map(user => {
                                const userKey = user.user_id || user.id.toString();
                                const isVisible = columnVisibility.users[userKey] !== false;
                                return isVisible ? (
                                    <td key={user.id} className="h-7 py-1 px-2 text-center">
                                        {formatMoney(calculateUserMetrics(user).annualCallPremium)}
                                    </td>
                                ) : null;
                            })}
                        </tr>
                        {/* Annual Target */}
                        <tr className="border-t hover:bg-secondary/20 bg-slate-50/50">
                            <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-slate-50/50 z-10 border-r whitespace-nowrap">權利金-年-目標</td>
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

                    </tbody>
                </table>
            </div>
        </div >
    );
}
