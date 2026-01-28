import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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
                        <tr className="border-t hover:bg-secondary/20 bg-white">
                            <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-white z-10 border-r">當前淨值</td>
                            {users.map(user => (
                                <td key={user.id} className="h-7 py-1 px-2 text-center">
                                    {formatMoney(user.current_net_equity || 0)}
                                </td>
                            ))}
                        </tr>

                        {/* 2. Initial Net Equity */}
                        <tr className="border-t hover:bg-secondary/20 bg-slate-50/50">
                            <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-slate-50/50 z-10 border-r">年初淨值</td>
                            {users.map(user => (
                                <td key={user.id} className="h-7 py-1 px-2 text-center">
                                    {formatMoney(user.initial_cost || 0)}
                                </td>
                            ))}
                        </tr>

                        {/* 3. Transfer Record */}
                        <tr className="border-t hover:bg-secondary/20 bg-white">
                            <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-white z-10 border-r">轉帳記錄</td>
                            {users.map(user => (
                                <td key={user.id} className="h-7 py-1 px-2 text-center">
                                    {formatMoney(user.total_deposit || 0)}
                                </td>
                            ))}
                        </tr>

                        {/* 4. Net Profit */}
                        <tr className="border-t hover:bg-secondary/20 bg-slate-50/50">
                            <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-slate-50/50 z-10 border-r">淨利潤</td>
                            {users.map(user => {
                                const profit = (user.current_net_equity || 0) - (user.initial_cost || 0) - (user.total_deposit || 0);
                                return (
                                    <td key={user.id} className="h-7 py-1 px-2 text-center">
                                        {formatMoney(profit)}
                                    </td>
                                );
                            })}
                        </tr>

                        {/* 5. Cash Balance */}
                        <tr className="border-t hover:bg-secondary/20 bg-white">
                            <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-white z-10 border-r">帳戶現金</td>
                            {users.map(user => (
                                <td key={user.id} className="h-7 py-1 px-2 text-center">
                                    {formatMoney(user.current_cash_balance || 0)}
                                </td>
                            ))}
                        </tr>

                        {/* 6. Return Rate */}
                        <tr className="border-t hover:bg-secondary/20 bg-slate-50/50">
                            <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-slate-50/50 z-10 border-r">報酬率</td>
                            {users.map(user => (
                                <td key={user.id} className="h-7 py-1 px-2 text-center">
                                    <StatBadge value={user.stats?.returnPercentage || 0} />
                                </td>
                            ))}
                        </tr>

                        {/* 7. Max Drawdown */}
                        <tr className="border-t hover:bg-secondary/20 bg-white">
                            <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-white z-10 border-r">最大回撤</td>
                            {users.map(user => (
                                <td key={user.id} className="h-7 py-1 px-2 text-center">
                                    <StatBadge value={user.stats?.maxDrawdown || 0} variant="drawdown" />
                                </td>
                            ))}
                        </tr>

                        {/* 8. Annualized Return */}
                        <tr className="border-t hover:bg-secondary/20 bg-slate-50/50">
                            <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-slate-50/50 z-10 border-r">年化報酬率</td>
                            {users.map(user => (
                                <td key={user.id} className="h-7 py-1 px-2 text-center">
                                    {formatPercent(user.stats?.annualizedReturn || 0)}
                                </td>
                            ))}
                        </tr>

                        {/* 9. Annualized StdDev */}
                        <tr className="border-t hover:bg-secondary/20 bg-white">
                            <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-white z-10 border-r">年化標準差</td>
                            {users.map(user => (
                                <td key={user.id} className="h-7 py-1 px-2 text-center">
                                    {formatPercent(user.stats?.annualizedStdDev || 0)}
                                </td>
                            ))}
                        </tr>

                        {/* 10. Sharpe Ratio */}
                        <tr className="border-t hover:bg-secondary/20 bg-slate-50/50">
                            <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-slate-50/50 z-10 border-r">夏普值</td>
                            {users.map(user => (
                                <td key={user.id} className="h-7 py-1 px-2 text-center">
                                    <StatBadge value={user.stats?.sharpeRatio || 0} variant="sharpe" format={(v) => v.toFixed(2)} />
                                </td>
                            ))}
                        </tr>

                        {/* 11. New High Count */}
                        <tr className="border-t hover:bg-secondary/20 bg-white">
                            <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-white z-10 border-r">新高次數</td>
                            {users.map(user => (
                                <td key={user.id} className="h-7 py-1 px-2 text-center">
                                    {user.stats?.newHighCount || 0}
                                </td>
                            ))}
                        </tr>

                        {/* 12. New High Freq */}
                        <tr className="border-t hover:bg-secondary/20 bg-slate-50/50">
                            <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-slate-50/50 z-10 border-r">新高頻率</td>
                            {users.map(user => (
                                <td key={user.id} className="h-7 py-1 px-2 text-center">
                                    {Math.round((user.stats?.newHighFreq || 0) * 100)}%
                                </td>
                            ))}
                        </tr>

                        {/* 13. Last Updated Date */}
                        <tr className="border-t hover:bg-secondary/20 bg-white">
                            <td className="h-7 py-1 px-2 font-medium sticky left-0 bg-white z-10 border-r">最後更新日</td>
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
                    </tbody>
                </table>
            </div>
        </div >
    );
}
