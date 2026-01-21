'use client';

import { useState, useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface MonthlyAnalysis {
    month: string;
    put_win_rate: number;
    call_win_rate: number;
    total_win_rate: number;
    put_delta: number;
    call_delta: number;
    total_delta: number;
    avg_iv: number;
    capital_efficiency: number;
    capital_flow: number;
}

interface User {
    id: number;
    user_id: string;
    email: string;
}

interface UserAnalysisPanelProps {
    user: User | null;
    year: string;
}

export function UserAnalysisPanel({ user, year }: UserAnalysisPanelProps) {
    const [analysis, setAnalysis] = useState<MonthlyAnalysis[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (user) {
            fetchAnalysis();
        }
    }, [user, year]);

    // Auto-scroll to panel when it opens
    useEffect(() => {
        const timer = setTimeout(() => {
            if (panelRef.current) {
                panelRef.current.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        }, 100);

        return () => clearTimeout(timer);
    }, [user]);

    const fetchAnalysis = async () => {
        if (!user) return;

        try {
            setIsLoading(true);
            const res = await fetch(`/api/users/analysis?userId=${user.id}&year=${year}`);
            const data = await res.json();

            if (data.success) {
                setAnalysis(data.monthly_analysis);
            }
        } catch (error) {
            console.error('Failed to fetch analysis:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const formatPercent = (value: number) => {
        return value > 0 ? `${value.toFixed(1)}%` : '';
    };

    const formatDecimal = (value: number) => {
        return value > 0 ? value.toFixed(3) : '';
    };

    const formatNumber = (value: number) => {
        return value > 0 ? value.toLocaleString() : '';
    };

    // Calculate totals
    const totals = analysis.reduce((acc, month) => {
        // Sum values
        acc.put_win_rate_sum += month.put_win_rate;
        acc.call_win_rate_sum += month.call_win_rate;
        acc.total_win_rate_sum += month.total_win_rate;
        acc.put_delta_sum += month.put_delta;
        acc.call_delta_sum += month.call_delta;
        acc.total_delta_sum += month.total_delta;
        acc.avg_iv_sum += month.avg_iv;
        acc.capital_efficiency_sum += month.capital_efficiency;
        acc.capital_flow_total += month.capital_flow;

        // Count months with data for each metric
        if (month.put_win_rate > 0) acc.put_win_rate_count++;
        if (month.call_win_rate > 0) acc.call_win_rate_count++;
        if (month.total_win_rate > 0) acc.total_win_rate_count++;
        if (month.put_delta > 0) acc.put_delta_count++;
        if (month.call_delta > 0) acc.call_delta_count++;
        if (month.total_delta > 0) acc.total_delta_count++;
        if (month.avg_iv > 0) acc.avg_iv_count++;
        if (month.capital_efficiency > 0) acc.capital_efficiency_count++;

        return acc;
    }, {
        put_win_rate_sum: 0,
        call_win_rate_sum: 0,
        total_win_rate_sum: 0,
        put_delta_sum: 0,
        call_delta_sum: 0,
        total_delta_sum: 0,
        avg_iv_sum: 0,
        capital_efficiency_sum: 0,
        capital_flow_total: 0,
        put_win_rate_count: 0,
        call_win_rate_count: 0,
        total_win_rate_count: 0,
        put_delta_count: 0,
        call_delta_count: 0,
        total_delta_count: 0,
        avg_iv_count: 0,
        capital_efficiency_count: 0
    });

    const displayName = user?.user_id || user?.email || '';

    if (!user) return null;

    return (
        <Card ref={panelRef} className="w-full border shadow-sm bg-white p-0 rounded-lg overflow-hidden">
            <CardContent className="p-0">
                {isLoading ? (
                    <div className="flex justify-center py-12">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                ) : (
                    <div className="overflow-x-auto rounded-lg" style={{ padding: '0' }}>
                        <table className="w-full border-collapse" style={{ fontSize: '13px' }}>
                            <thead>
                                <tr className="bg-[#e8e4dc]">
                                    <th className="border px-2 py-1.5 text-center font-medium whitespace-nowrap text-foreground h-7"></th>
                                    <th className="border px-2 py-1.5 text-center font-medium whitespace-nowrap text-foreground h-7">PUT勝率</th>
                                    <th className="border px-2 py-1.5 text-center font-medium whitespace-nowrap text-foreground h-7">CALL勝率</th>
                                    <th className="border px-2 py-1.5 text-center font-medium whitespace-nowrap text-foreground h-7">總勝率</th>
                                    <th className="border px-2 py-1.5 text-center font-medium whitespace-nowrap text-foreground h-7">PUT Delta</th>
                                    <th className="border px-2 py-1.5 text-center font-medium whitespace-nowrap text-foreground h-7">CALL Delta</th>
                                    <th className="border px-2 py-1.5 text-center font-medium whitespace-nowrap text-foreground h-7">總Delta</th>
                                    <th className="border px-2 py-1.5 text-center font-medium whitespace-nowrap text-foreground h-7">隱含波動</th>
                                    <th className="border px-2 py-1.5 text-center font-medium whitespace-nowrap text-foreground h-7">資金效率</th>
                                    <th className="border px-2 py-1.5 text-center font-medium whitespace-nowrap text-foreground h-7">資金流水</th>
                                </tr>
                            </thead>
                            <tbody>
                                {analysis.map((month) => (
                                    <tr key={month.month} className="hover:bg-gray-100 odd:bg-white even:bg-gray-50">
                                        <td className="border px-2 text-center whitespace-nowrap text-gray-900 h-7">{month.month}月</td>
                                        <td className="border px-2 text-center whitespace-nowrap text-gray-900 h-7">{formatPercent(month.put_win_rate)}</td>
                                        <td className="border px-2 text-center whitespace-nowrap text-gray-900 h-7">{formatPercent(month.call_win_rate)}</td>
                                        <td className="border px-2 text-center whitespace-nowrap text-gray-900 h-7">{formatPercent(month.total_win_rate)}</td>
                                        <td className="border px-2 text-center whitespace-nowrap text-gray-900 h-7">{formatDecimal(month.put_delta)}</td>
                                        <td className="border px-2 text-center whitespace-nowrap text-gray-900 h-7">{formatDecimal(month.call_delta)}</td>
                                        <td className="border px-2 text-center whitespace-nowrap text-gray-900 h-7">{formatDecimal(month.total_delta)}</td>
                                        <td className="border px-2 text-center whitespace-nowrap text-gray-900 h-7">{formatDecimal(month.avg_iv)}</td>
                                        <td className="border px-2 text-center whitespace-nowrap text-gray-900 h-7">{month.capital_efficiency > 0 ? `${month.capital_efficiency.toFixed(3)}%` : ''}</td>
                                        <td className="border px-2 text-center whitespace-nowrap text-gray-900 h-7">{formatNumber(month.capital_flow)}</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr className="bg-[#e8e4dc] text-foreground">
                                    <td className="border px-2 text-center whitespace-nowrap h-7">總結</td>
                                    <td className="border px-2 text-center whitespace-nowrap h-7">{totals.put_win_rate_count > 0 ? formatPercent(totals.put_win_rate_sum / totals.put_win_rate_count) : ''}</td>
                                    <td className="border px-2 text-center whitespace-nowrap h-7">{totals.call_win_rate_count > 0 ? formatPercent(totals.call_win_rate_sum / totals.call_win_rate_count) : ''}</td>
                                    <td className="border px-2 text-center whitespace-nowrap h-7">{totals.total_win_rate_count > 0 ? formatPercent(totals.total_win_rate_sum / totals.total_win_rate_count) : ''}</td>
                                    <td className="border px-2 text-center whitespace-nowrap h-7">{totals.put_delta_count > 0 ? formatDecimal(totals.put_delta_sum / totals.put_delta_count) : ''}</td>
                                    <td className="border px-2 text-center whitespace-nowrap h-7">{totals.call_delta_count > 0 ? formatDecimal(totals.call_delta_sum / totals.call_delta_count) : ''}</td>
                                    <td className="border px-2 text-center whitespace-nowrap h-7">{totals.total_delta_count > 0 ? formatDecimal(totals.total_delta_sum / totals.total_delta_count) : ''}</td>
                                    <td className="border px-2 text-center whitespace-nowrap h-7">{totals.avg_iv_count > 0 ? formatDecimal(totals.avg_iv_sum / totals.avg_iv_count) : ''}</td>
                                    <td className="border px-2 text-center whitespace-nowrap h-7">{totals.capital_efficiency_count > 0 ? `${(totals.capital_efficiency_sum / totals.capital_efficiency_count).toFixed(3)}%` : ''}</td>
                                    <td className="border px-2 text-center whitespace-nowrap h-7">{formatNumber(totals.capital_flow_total)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
