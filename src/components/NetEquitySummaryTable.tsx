import { useState, useEffect } from "react";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Eye, EyeOff, RotateCcw, Save } from "lucide-react";

interface UserSummary {
    id: number;
    user_id: string;
    email: string;
    initial_cost: number;
    current_net_equity: number;
    current_cash_balance?: number;
    total_daily_interest?: number;
    open_put_covered_capital?: number;
    total_deposit?: number;
    top_holdings?: Array<{
        symbol: string;
        quantity: number;
    }>;
    stats: {
        startDate: number;
        returnPercentage: number;
        maxDrawdown: number;
        annualizedReturn: number;
        annualizedStdDev: number;
        sharpeRatio: number;
        newHighCount: number;
        newHighFreq: number;
    } | null;
    equity_history?: {
        date: number;
        net_equity: number;
    }[];
}

interface NetEquitySummaryTableProps {
    users: UserSummary[];
    onUserClick: (userId: number) => void;
}

export function NetEquitySummaryTable({ users, onUserClick }: NetEquitySummaryTableProps) {
    // Row visibility state (resets to all visible on page reload)
    const [visibleRows, setVisibleRows] = useState<Record<string, boolean>>({
        currentNetEquity: true,
        initialNetEquity: true,
        transferRecord: true,
        initialCost: true,
        netProfit: true,
        potentialMargin: true,
        cashBalance: true,
        totalInterest: true,
        returnRate: true,
        maxDrawdown: true,
        annualizedReturn: true,
        annualizedStdDev: true,
        sharpeRatio: true,
        newHighCount: true,
        newHighFreq: true,
        lastUpdated: true,
    });

    // Column (user) visibility state
    const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>({});

    // Initialize column visibility when users change
    useEffect(() => {
        const savedColSettings = localStorage.getItem('netEquityTableColumnVisibility');
        if (savedColSettings) {
            try {
                setVisibleColumns(JSON.parse(savedColSettings));
            } catch {
                const defaults = users.reduce((acc, u) => { acc[u.user_id || u.id.toString()] = true; return acc; }, {} as Record<string, boolean>);
                setVisibleColumns(defaults);
            }
        } else {
            const defaults = users.reduce((acc, u) => { acc[u.user_id || u.id.toString()] = true; return acc; }, {} as Record<string, boolean>);
            setVisibleColumns(defaults);
        }
    }, [users]);

    const toggleColumn = (colKey: string) => {
        setVisibleColumns(prev => ({ ...prev, [colKey]: !prev[colKey] }));
    };

    const isColumnVisible = (user: UserSummary) => {
        const key = user.user_id || user.id.toString();
        return visibleColumns[key] !== false;
    };

    // Track if settings are saved in localStorage
    const [hasSavedSettings, setHasSavedSettings] = useState(false);

    // Toggle row visibility (no persistence)
    const toggleRow = (rowKey: string) => {
        setVisibleRows(prev => ({
            ...prev,
            [rowKey]: !prev[rowKey]
        }));
    };

    // Reset all rows and columns to visible
    const resetVisibility = () => {
        const allVisible: Record<string, boolean> = {
            currentNetEquity: true,
            initialNetEquity: true,
            transferRecord: true,
            initialCost: true,
            netProfit: true,
            potentialMargin: true,
            cashBalance: true,
            returnRate: true,
            maxDrawdown: true,
            annualizedReturn: true,
            annualizedStdDev: true,
            sharpeRatio: true,
            newHighCount: true,
            newHighFreq: true,
            lastUpdated: true,
        };
        // Also reset holding rows
        for (let i = 0; i < 10; i++) allVisible[`holding${i}`] = true;
        setVisibleRows(allVisible);
        const allColsVisible = users.reduce((acc, u) => { acc[u.user_id || u.id.toString()] = true; return acc; }, {} as Record<string, boolean>);
        setVisibleColumns(allColsVisible);
        // Also clear from localStorage
        localStorage.removeItem('netEquityTableVisibility');
        localStorage.removeItem('netEquityTableColumnVisibility');
        setHasSavedSettings(false);
    };

    // Save current visibility state to localStorage
    const saveVisibility = () => {
        localStorage.setItem('netEquityTableVisibility', JSON.stringify(visibleRows));
        localStorage.setItem('netEquityTableColumnVisibility', JSON.stringify(visibleColumns));
        setHasSavedSettings(true);
    };

    // Load saved visibility settings on mount
    useEffect(() => {
        const savedSettings = localStorage.getItem('netEquityTableVisibility');
        if (savedSettings) {
            try {
                const parsed = JSON.parse(savedSettings);
                // Merge with initial state to preserve new keys like holding1/2/3
                setVisibleRows(prev => ({ ...prev, ...parsed }));
                setHasSavedSettings(true);
            } catch (error) {
                console.error('Failed to parse saved visibility settings:', error);
            }
        }
    }, []);

    const formatMoney = (val: number) => {
        return new Intl.NumberFormat('en-US').format(Math.round(val));
    };

    const formatPercent = (val: number) => {
        return `${(val * 100).toFixed(2)}%`;
    };

    const formatDateYYMMDD = (timestamp: number) => {
        const date = new Date(timestamp * 1000);
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        return `${mm}-${dd}`;
    };

    const StatBadge = ({ value, variant = 'return', format }: { value: number, variant?: 'return' | 'drawdown' | 'sharpe', format?: (v: number) => string }) => {
        // Cream background, gold border, brown text for all values (positive, negative, drawdown)
        const colorClass = "bg-[#FFF9E5] text-[#78350F] border-[#FCD34D]";

        // Display positive value for drawdown as per user request
        const displayValue = variant === 'drawdown' ? Math.abs(value) : value;

        return (
            <span className={`inline-flex items-center justify-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${colorClass}`}>
                {format ? format(displayValue) : formatPercent(displayValue)}
            </span>
        );
    };

    // Row toggle icon component
    const RowToggleIcon = ({ rowKey, visible }: { rowKey: string, visible: boolean }) => {
        const Icon = visible ? Eye : EyeOff;
        return (
            <button
                onClick={() => toggleRow(rowKey)}
                className="inline-flex items-center justify-center w-4 h-4 mr-2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                title={visible ? "隱藏此列" : "顯示此列"}
            >
                <Icon className="w-3.5 h-3.5" />
            </button>
        );
    };

    // Chinese numeral labels for holdings
    const chineseNumerals = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

    // Compute max holdings across all visible users
    const visibleUsers = users.filter(isColumnVisible);
    const maxHoldings = visibleUsers.reduce((max, user) => {
        return Math.max(max, user.top_holdings?.length || 0);
    }, 0);

    if (!users || users.length === 0) return null;

    return (
        <div className="rounded-md border bg-white mb-8 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                    {/* Header: Users */}
                    <thead>
                        <tr className="border-b bg-muted/40 text-[13px] font-medium">
                            <td className="py-1 px-2 w-[180px] sticky left-0 bg-muted/40 z-10 border-r">
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
                            {users.map((user) => {
                                if (!isColumnVisible(user)) return null;
                                const colKey = user.user_id || user.id.toString();
                                return (
                                    <td key={user.id} className="text-center min-w-[140px] px-2 py-1 bg-muted/40">
                                        <div className="inline-flex items-center justify-center gap-0">
                                            <button
                                                onClick={() => toggleColumn(colKey)}
                                                className="inline-flex items-center justify-center w-5 h-5 text-blue-600 hover:text-blue-800 transition-colors cursor-pointer"
                                                title="隱藏此列"
                                            >
                                                <Eye className="w-3.5 h-3.5" />
                                            </button>
                                            <span
                                                className="font-bold text-foreground cursor-pointer hover:bg-black/5 rounded-md px-1 py-0.5 transition-colors"
                                                onClick={() => onUserClick(user.id)}
                                            >
                                                {user.user_id || user.email.split('@')[0]}
                                            </span>
                                        </div>
                                    </td>
                                );
                            })}
                        </tr>
                    </thead>
                    <tbody className="text-[13px]">
                        {/* 0. Last Updated Date */}
                        {visibleRows.lastUpdated && (
                            <tr className="border-t hover:bg-secondary/20 bg-white">
                                <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-white z-10 border-r">
                                    <RowToggleIcon rowKey="lastUpdated" visible={visibleRows.lastUpdated} />
                                    最後更新日
                                </td>
                                {users.filter(isColumnVisible).map(user => {
                                    const lastDate = user.equity_history && user.equity_history.length > 0
                                        ? user.equity_history[user.equity_history.length - 1].date
                                        : null;
                                    return (
                                        <td key={user.id} className="h-7 py-1 px-2 text-center">
                                            {lastDate ? formatDateYYMMDD(lastDate) : '-'}
                                        </td>
                                    );
                                })}
                            </tr>
                        )}

                        {/* 1. Current Net Equity */}
                        {visibleRows.currentNetEquity && (
                            <tr className="border-t-2 border-gray-300 hover:bg-secondary/20 bg-white">
                                <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-white z-10 border-r">
                                    <RowToggleIcon rowKey="currentNetEquity" visible={visibleRows.currentNetEquity} />
                                    當前淨值
                                </td>
                                {users.filter(isColumnVisible).map(user => (
                                    <td key={user.id} className="h-7 py-1 px-2 text-center">
                                        {formatMoney(user.current_net_equity || 0)}
                                    </td>
                                ))}
                            </tr>
                        )}

                        {/* 2. Initial Net Equity */}
                        {visibleRows.initialNetEquity && (
                            <tr className="border-t hover:bg-secondary/20 bg-slate-50/50">
                                <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-slate-50/50 z-10 border-r">
                                    <RowToggleIcon rowKey="initialNetEquity" visible={visibleRows.initialNetEquity} />
                                    年初淨值
                                </td>
                                {users.filter(isColumnVisible).map(user => (
                                    <td key={user.id} className="h-7 py-1 px-2 text-center">
                                        {formatMoney(user.initial_cost || 0)}
                                    </td>
                                ))}
                            </tr>
                        )}

                        {/* 3. Transfer Record */}
                        {visibleRows.transferRecord && (
                            <tr className="border-t hover:bg-secondary/20 bg-white">
                                <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-white z-10 border-r">
                                    <RowToggleIcon rowKey="transferRecord" visible={visibleRows.transferRecord} />
                                    存款和取款
                                </td>
                                {users.filter(isColumnVisible).map(user => (
                                    <td key={user.id} className="h-7 py-1 px-2 text-center">
                                        {formatMoney(user.total_deposit || 0)}
                                    </td>
                                ))}
                            </tr>
                        )}

                        {/* 4. Initial Cost */}
                        {visibleRows.initialCost && (
                            <tr className="border-t hover:bg-secondary/20 bg-slate-50/50">
                                <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-slate-50/50 z-10 border-r">
                                    <RowToggleIcon rowKey="initialCost" visible={visibleRows.initialCost} />
                                    初始成本
                                </td>
                                {users.filter(isColumnVisible).map(user => (
                                    <td key={user.id} className="h-7 py-1 px-2 text-center">
                                        {formatMoney((user.initial_cost || 0) + (user.total_deposit || 0))}
                                    </td>
                                ))}
                            </tr>
                        )}

                        {/* 5. Net Profit */}
                        {visibleRows.netProfit && (
                            <tr className="border-t hover:bg-secondary/20 bg-slate-50/50">
                                <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-slate-50/50 z-10 border-r">
                                    <RowToggleIcon rowKey="netProfit" visible={visibleRows.netProfit} />
                                    淨利潤
                                </td>
                                {users.filter(isColumnVisible).map(user => {
                                    const profit = (user.current_net_equity || 0) - (user.initial_cost || 0) - (user.total_deposit || 0);
                                    const isNegative = profit < 0;
                                    return (
                                        <td
                                            key={user.id}
                                            className={cn(
                                                "h-7 py-1 px-2 text-center",
                                                isNegative && "bg-pink-50"
                                            )}
                                        >
                                            {formatMoney(profit)}
                                        </td>
                                    );
                                })}
                            </tr>
                        )}

                        {/* 6. Return Rate */}
                        {visibleRows.returnRate && (
                            <tr className="border-t-2 border-gray-300 hover:bg-secondary/20 bg-slate-50/50">
                                <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-slate-50/50 z-10 border-r">
                                    <RowToggleIcon rowKey="returnRate" visible={visibleRows.returnRate} />
                                    報酬率
                                </td>
                                {users.filter(isColumnVisible).map(user => (
                                    <td key={user.id} className="h-7 py-1 px-2 text-center">
                                        <StatBadge value={user.stats?.returnPercentage || 0} />
                                    </td>
                                ))}
                            </tr>
                        )}

                        {/* 8. Max Drawdown */}
                        {visibleRows.maxDrawdown && (
                            <tr className="border-t hover:bg-secondary/20 bg-white">
                                <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-white z-1 border-r">
                                    <RowToggleIcon rowKey="maxDrawdown" visible={visibleRows.maxDrawdown} />
                                    最大回撤
                                </td>
                                {users.filter(isColumnVisible).map(user => (
                                    <td key={user.id} className="h-7 py-1 px-2 text-center">
                                        <StatBadge value={user.stats?.maxDrawdown || 0} variant="drawdown" />
                                    </td>
                                ))}
                            </tr>
                        )}

                        {/* 9. Annualized Return */}
                        {visibleRows.annualizedReturn && (
                            <tr className="border-t hover:bg-secondary/20 bg-slate-50/50">
                                <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-slate-50/50 z-10 border-r">
                                    <RowToggleIcon rowKey="annualizedReturn" visible={visibleRows.annualizedReturn} />
                                    年化報酬率
                                </td>
                                {users.filter(isColumnVisible).map(user => (
                                    <td key={user.id} className="h-7 py-1 px-2 text-center">
                                        {formatPercent(user.stats?.annualizedReturn || 0)}
                                    </td>
                                ))}
                            </tr>
                        )}

                        {/* 10. Annualized StdDev */}
                        {visibleRows.annualizedStdDev && (
                            <tr className="border-t hover:bg-secondary/20 bg-white">
                                <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-white z-10 border-r">
                                    <RowToggleIcon rowKey="annualizedStdDev" visible={visibleRows.annualizedStdDev} />
                                    年化標準差
                                </td>
                                {users.filter(isColumnVisible).map(user => (
                                    <td key={user.id} className="h-7 py-1 px-2 text-center">
                                        {formatPercent(user.stats?.annualizedStdDev || 0)}
                                    </td>
                                ))}
                            </tr>
                        )}

                        {/* 11. Sharpe Ratio */}
                        {visibleRows.sharpeRatio && (
                            <tr className="border-t hover:bg-secondary/20 bg-slate-50/50">
                                <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-slate-50/50 z-10 border-r">
                                    <RowToggleIcon rowKey="sharpeRatio" visible={visibleRows.sharpeRatio} />
                                    夏普值
                                </td>
                                {users.filter(isColumnVisible).map(user => (
                                    <td key={user.id} className="h-7 py-1 px-2 text-center">
                                        <StatBadge value={user.stats?.sharpeRatio || 0} variant="sharpe" format={(v) => v.toFixed(2)} />
                                    </td>
                                ))}
                            </tr>
                        )}

                        {/* 12. New High Count */}
                        {visibleRows.newHighCount && (
                            <tr className="border-t-2 border-gray-300 hover:bg-secondary/20 bg-white">
                                <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-white z-10 border-r">
                                    <RowToggleIcon rowKey="newHighCount" visible={visibleRows.newHighCount} />
                                    新高次數
                                </td>
                                {users.filter(isColumnVisible).map(user => (
                                    <td key={user.id} className="h-7 py-1 px-2 text-center">
                                        {user.stats?.newHighCount || 0}
                                    </td>
                                ))}
                            </tr>
                        )}

                        {/* 13. New High Freq */}
                        {visibleRows.newHighFreq && (
                            <tr className="border-t hover:bg-secondary/20 bg-slate-50/50">
                                <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-slate-50/50 z-10 border-r">
                                    <RowToggleIcon rowKey="newHighFreq" visible={visibleRows.newHighFreq} />
                                    新高頻率
                                </td>
                                {users.filter(isColumnVisible).map(user => (
                                    <td key={user.id} className="h-7 py-1 px-2 text-center">
                                        {Math.round((user.stats?.newHighFreq || 0) * 100)}%
                                    </td>
                                ))}
                            </tr>
                        )}

                        {/* 13.5. Potential Margin */}
                        {visibleRows.potentialMargin && (
                            <tr className="border-t-2 border-gray-300 hover:bg-secondary/20 bg-white">
                                <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-white z-10 border-r">
                                    <RowToggleIcon rowKey="potentialMargin" visible={visibleRows.potentialMargin} />
                                    潛在融資
                                </td>
                                {users.filter(isColumnVisible).map(user => {
                                    const equity = user.current_net_equity || 0;
                                    const debt = Math.abs(Math.min(0, user.current_cash_balance || 0));
                                    const marginUsed = (user.open_put_covered_capital || 0) + debt;
                                    const marginRate = equity > 0 ? marginUsed / equity : 0;
                                    return (
                                        <td key={user.id} className="h-7 py-1 px-2 text-center">
                                            <StatBadge value={marginRate} format={(v) => `${Math.round(v * 100)}%`} />
                                        </td>
                                    );
                                })}
                            </tr>
                        )}

                        {/* 14. Cash Balance */}
                        {visibleRows.cashBalance && (
                            <tr className="border-t hover:bg-secondary/20 bg-slate-50/50">
                                <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-slate-50/50 z-10 border-r">
                                    <RowToggleIcon rowKey="cashBalance" visible={visibleRows.cashBalance} />
                                    帳戶現金
                                </td>
                                {users.filter(isColumnVisible).map(user => {
                                    const cashBalance = user.current_cash_balance || 0;
                                    const isNegative = cashBalance < 0;
                                    return (
                                        <td
                                            key={user.id}
                                            className={cn(
                                                "h-7 py-1 px-2 text-center",
                                                isNegative && "bg-pink-50"
                                            )}
                                        >
                                            {formatMoney(cashBalance)}
                                        </td>
                                    );
                                })}
                            </tr>
                        )}

                        {/* 14.5. Total Interest */}
                        {visibleRows.totalInterest && (
                            <tr className="border-t hover:bg-secondary/20 bg-white">
                                <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-white z-10 border-r">
                                    <RowToggleIcon rowKey="totalInterest" visible={visibleRows.totalInterest} />
                                    利息總合
                                </td>
                                {users.filter(isColumnVisible).map(user => {
                                    const totalInterest = (user as any).total_daily_interest || 0;
                                    return (
                                        <td
                                            key={user.id}
                                            className={cn(
                                                "h-7 py-1 px-2 text-center",
                                                totalInterest < 0 && "bg-pink-50"
                                            )}
                                        >
                                            {formatMoney(totalInterest)}
                                        </td>
                                    );
                                })}
                            </tr>
                        )}

                        {/* Dynamic Holdings */}
                        {Array.from({ length: maxHoldings }, (_, idx) => {
                            const rowKey = `holding${idx}`;
                            const isVisible = visibleRows[rowKey] !== false;
                            if (!isVisible) return null;
                            const bgClass = idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50';
                            return (
                                <tr key={rowKey} className={`border-t hover:bg-secondary/20 ${bgClass}`}>
                                    <td className={`h-7 py-1 px-2 font-medium sticky left-0 ${bgClass} z-10 border-r`}>
                                        <RowToggleIcon rowKey={rowKey} visible={isVisible} />
                                        持股{chineseNumerals[idx] || (idx + 1)}
                                    </td>
                                    {users.filter(isColumnVisible).map(user => {
                                        const holding = user.top_holdings?.[idx];
                                        const isNonStandard = holding && !['QQQ', 'QLD'].includes(holding.symbol);
                                        return (
                                            <td key={user.id} className={cn("h-7 py-1 px-2 text-center text-xs", isNonStandard && "bg-pink-50")}>
                                                {holding ? `${holding.symbol} * ${Math.round(holding.quantity).toLocaleString()}` : '-'}
                                            </td>
                                        );
                                    })}
                                </tr>
                            );
                        })}



                    </tbody>
                </table>
            </div>
        </div >
    );
}
