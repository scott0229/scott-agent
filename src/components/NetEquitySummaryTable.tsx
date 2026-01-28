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
    total_deposit?: number;
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
        netProfit: true,
        cashBalance: true,
        returnRate: true,
        maxDrawdown: true,
        annualizedReturn: true,
        annualizedStdDev: true,
        sharpeRatio: true,
        newHighCount: true,
        newHighFreq: true,
        lastUpdated: true,
    });

    // Toggle row visibility (no persistence)
    const toggleRow = (rowKey: string) => {
        setVisibleRows(prev => ({
            ...prev,
            [rowKey]: !prev[rowKey]
        }));
    };

    // Reset all rows to visible
    const resetVisibility = () => {
        const allVisible: Record<string, boolean> = {
            currentNetEquity: true,
            initialNetEquity: true,
            transferRecord: true,
            netProfit: true,
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
        setVisibleRows(allVisible);
        // Also clear from localStorage
        localStorage.removeItem('netEquityTableVisibility');
    };

    // Save current visibility state to localStorage
    const saveVisibility = () => {
        localStorage.setItem('netEquityTableVisibility', JSON.stringify(visibleRows));
    };

    // Load saved visibility settings on mount
    useEffect(() => {
        const savedSettings = localStorage.getItem('netEquityTableVisibility');
        if (savedSettings) {
            try {
                const parsed = JSON.parse(savedSettings);
                setVisibleRows(parsed);
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
        const yy = date.getFullYear().toString().slice(-2);
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        return `${yy}-${mm}-${dd}`;
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

    if (!users || users.length === 0) return null;

    return (
        <div className="rounded-md border bg-white mb-8 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                    {/* Header: Users */}
                    <thead>
                        <tr className="border-b bg-muted/40 text-[13px] font-medium">
                            <td className="py-1 px-2 w-[120px] sticky left-0 bg-muted/40 z-10 border-r"></td>
                            {users.map((user) => (
                                <td key={user.id} className="text-center min-w-[140px] px-2 py-1 bg-muted/40">
                                    <div
                                        className="inline-flex items-center justify-center gap-1.5 cursor-pointer hover:bg-black/5 rounded-md px-2 py-1 transition-colors"
                                        onClick={() => onUserClick(user.id)}
                                    >
                                        <div className="h-2 w-2 rounded-full bg-blue-600" />
                                        <span className="font-bold text-foreground">{user.user_id || user.email.split('@')[0]}</span>
                                    </div>
                                </td>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="text-[13px]">
                        {/* 1. Current Net Equity */}
                        {visibleRows.currentNetEquity && (
                            <tr className="border-t hover:bg-secondary/20 bg-white">
                                <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-white z-10 border-r">
                                    <RowToggleIcon rowKey="currentNetEquity" visible={visibleRows.currentNetEquity} />
                                    當前淨值
                                </td>
                                {users.map(user => (
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
                                {users.map(user => (
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
                                    轉帳記錄
                                </td>
                                {users.map(user => (
                                    <td key={user.id} className="h-7 py-1 px-2 text-center">
                                        {formatMoney(user.total_deposit || 0)}
                                    </td>
                                ))}
                            </tr>
                        )}

                        {/* 4. Net Profit */}
                        {visibleRows.netProfit && (
                            <tr className="border-t hover:bg-secondary/20 bg-slate-50/50">
                                <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-slate-50/50 z-10 border-r">
                                    <RowToggleIcon rowKey="netProfit" visible={visibleRows.netProfit} />
                                    淨利潤
                                </td>
                                {users.map(user => {
                                    const profit = (user.current_net_equity || 0) - (user.initial_cost || 0) - (user.total_deposit || 0);
                                    return (
                                        <td key={user.id} className="h-7 py-1 px-2 text-center">
                                            {formatMoney(profit)}
                                        </td>
                                    );
                                })}
                            </tr>
                        )}

                        {/* 5. Cash Balance */}
                        {visibleRows.cashBalance && (
                            <tr className="border-t hover:bg-secondary/20 bg-white">
                                <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-white z-10 border-r">
                                    <RowToggleIcon rowKey="cashBalance" visible={visibleRows.cashBalance} />
                                    帳戶現金
                                </td>
                                {users.map(user => (
                                    <td key={user.id} className="h-7 py-1 px-2 text-center">
                                        {formatMoney(user.current_cash_balance || 0)}
                                    </td>
                                ))}
                            </tr>
                        )}

                        {/* 6. Return Rate */}
                        {visibleRows.returnRate && (
                            <tr className="border-t hover:bg-secondary/20 bg-slate-50/50">
                                <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-slate-50/50 z-10 border-r">
                                    <RowToggleIcon rowKey="returnRate" visible={visibleRows.returnRate} />
                                    報酬率
                                </td>
                                {users.map(user => (
                                    <td key={user.id} className="h-7 py-1 px-2 text-center">
                                        <StatBadge value={user.stats?.returnPercentage || 0} />
                                    </td>
                                ))}
                            </tr>
                        )}

                        {/* 7. Max Drawdown */}
                        {visibleRows.maxDrawdown && (
                            <tr className="border-t hover:bg-secondary/20 bg-white">
                                <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-white z-1 border-r">
                                    <RowToggleIcon rowKey="maxDrawdown" visible={visibleRows.maxDrawdown} />
                                    最大回撤
                                </td>
                                {users.map(user => (
                                    <td key={user.id} className="h-7 py-1 px-2 text-center">
                                        <StatBadge value={user.stats?.maxDrawdown || 0} variant="drawdown" />
                                    </td>
                                ))}
                            </tr>
                        )}

                        {/* 8. Annualized Return */}
                        {visibleRows.annualizedReturn && (
                            <tr className="border-t hover:bg-secondary/20 bg-slate-50/50">
                                <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-slate-50/50 z-10 border-r">
                                    <RowToggleIcon rowKey="annualizedReturn" visible={visibleRows.annualizedReturn} />
                                    年化報酬率
                                </td>
                                {users.map(user => (
                                    <td key={user.id} className="h-7 py-1 px-2 text-center">
                                        {formatPercent(user.stats?.annualizedReturn || 0)}
                                    </td>
                                ))}
                            </tr>
                        )}

                        {/* 9. Annualized StdDev */}
                        {visibleRows.annualizedStdDev && (
                            <tr className="border-t hover:bg-secondary/20 bg-white">
                                <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-white z-10 border-r">
                                    <RowToggleIcon rowKey="annualizedStdDev" visible={visibleRows.annualizedStdDev} />
                                    年化標準差
                                </td>
                                {users.map(user => (
                                    <td key={user.id} className="h-7 py-1 px-2 text-center">
                                        {formatPercent(user.stats?.annualizedStdDev || 0)}
                                    </td>
                                ))}
                            </tr>
                        )}

                        {/* 10. Sharpe Ratio */}
                        {visibleRows.sharpeRatio && (
                            <tr className="border-t hover:bg-secondary/20 bg-slate-50/50">
                                <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-slate-50/50 z-10 border-r">
                                    <RowToggleIcon rowKey="sharpeRatio" visible={visibleRows.sharpeRatio} />
                                    夏普值
                                </td>
                                {users.map(user => (
                                    <td key={user.id} className="h-7 py-1 px-2 text-center">
                                        <StatBadge value={user.stats?.sharpeRatio || 0} variant="sharpe" format={(v) => v.toFixed(2)} />
                                    </td>
                                ))}
                            </tr>
                        )}

                        {/* 11. New High Count */}
                        {visibleRows.newHighCount && (
                            <tr className="border-t hover:bg-secondary/20 bg-white">
                                <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-white z-10 border-r">
                                    <RowToggleIcon rowKey="newHighCount" visible={visibleRows.newHighCount} />
                                    新高次數
                                </td>
                                {users.map(user => (
                                    <td key={user.id} className="h-7 py-1 px-2 text-center">
                                        {user.stats?.newHighCount || 0}
                                    </td>
                                ))}
                            </tr>
                        )}

                        {/* 12. New High Freq */}
                        {visibleRows.newHighFreq && (
                            <tr className="border-t hover:bg-secondary/20 bg-slate-50/50">
                                <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-slate-50/50 z-10 border-r">
                                    <RowToggleIcon rowKey="newHighFreq" visible={visibleRows.newHighFreq} />
                                    新高頻率
                                </td>
                                {users.map(user => (
                                    <td key={user.id} className="h-7 py-1 px-2 text-center">
                                        {Math.round((user.stats?.newHighFreq || 0) * 100)}%
                                    </td>
                                ))}
                            </tr>
                        )}

                        {/* 13. Last Updated Date */}
                        {visibleRows.lastUpdated && (
                            <tr className="border-t hover:bg-secondary/20 bg-white">
                                <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-white z-10 border-r">
                                    <RowToggleIcon rowKey="lastUpdated" visible={visibleRows.lastUpdated} />
                                    最後更新日
                                </td>
                                {users.map(user => {
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

                        {/* Settings Controls Row */}
                        <tr className="border-t">
                            <td colSpan={users.length + 1} className="h-10 py-2 px-2">
                                <div className="flex justify-end gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={resetVisibility}
                                        className="text-xs h-7"
                                    >
                                        <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                                        重置隱藏
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={saveVisibility}
                                        className="text-xs h-7"
                                    >
                                        <Save className="w-3.5 h-3.5 mr-1.5" />
                                        記憶隱藏
                                    </Button>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div >
    );
}
