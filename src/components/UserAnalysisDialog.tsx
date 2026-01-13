'use client';

import { useState, useEffect, useRef } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

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

interface UserAnalysisDialogProps {
    user: User | null;
    year: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function UserAnalysisDialog({ user, year, open, onOpenChange }: UserAnalysisDialogProps) {
    const [analysis, setAnalysis] = useState<MonthlyAnalysis[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    // Drag functionality state
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const isDragging = useRef(false);
    const dragStart = useRef({ x: 0, y: 0 });
    const startOffset = useRef({ x: 0, y: 0 });

    const handleMouseDown = (e: React.MouseEvent) => {
        if (e.target instanceof Element && e.target.closest('button')) {
            return; // Don't start drag if clicking a button
        }
        isDragging.current = true;
        dragStart.current = { x: e.clientX, y: e.clientY };
        startOffset.current = { ...offset };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        document.body.style.userSelect = 'none'; // Prevent text selection while dragging
    };

    const handleMouseMove = (e: MouseEvent) => {
        if (!isDragging.current) return;

        const dx = e.clientX - dragStart.current.x;
        const dy = e.clientY - dragStart.current.y;

        setOffset({
            x: startOffset.current.x + dx,
            y: startOffset.current.y + dy
        });
    };

    const handleMouseUp = () => {
        isDragging.current = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.userSelect = '';
    };

    // Reset offset when dialog opens/closes
    useEffect(() => {
        if (!open) {
            setOffset({ x: 0, y: 0 });
        }
    }, [open]);

    useEffect(() => {
        if (open && user) {
            fetchAnalysis();
        }
    }, [open, user, year]);

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

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="p-0 gap-0 bg-[#fbf9f6] flex flex-col"
                style={{
                    maxWidth: '85vw',
                    width: 'fit-content',
                    minWidth: '800px',
                    maxHeight: '90vh',
                    marginLeft: `${offset.x}px`,
                    marginTop: `${offset.y}px`
                }}
            >
                <DialogHeader
                    className="px-4 pt-4 pb-3 cursor-move select-none flex-shrink-0"
                    onMouseDown={handleMouseDown}
                >
                    <DialogTitle>{displayName} - {year} 期權分析</DialogTitle>
                </DialogHeader>

                {isLoading ? (
                    <div className="flex justify-center py-8">載入中...</div>
                ) : (
                    <div className="overflow-x-auto overflow-y-auto flex-1" style={{ padding: '0 16px 16px 16px' }}>
                        <table className="border-collapse" style={{ fontSize: '13px', width: 'auto' }}>
                            <thead>
                                <tr className="bg-[#f0e8e0]">
                                    <th className="border border-[#decabb] py-2 px-4 text-center font-medium whitespace-nowrap text-[#5d4d42]">月份</th>
                                    <th className="border border-[#decabb] py-2 px-4 text-center font-medium whitespace-nowrap text-[#5d4d42]">PUT勝率</th>
                                    <th className="border border-[#decabb] py-2 px-4 text-center font-medium whitespace-nowrap text-[#5d4d42]">CALL勝率</th>
                                    <th className="border border-[#decabb] py-2 px-4 text-center font-medium whitespace-nowrap border-r-4 border-r-[#d6c2b1] text-[#5d4d42]">總勝率</th>
                                    <th className="border border-[#decabb] py-2 px-4 text-center font-medium whitespace-nowrap text-[#5d4d42]">PUT Delta</th>
                                    <th className="border border-[#decabb] py-2 px-4 text-center font-medium whitespace-nowrap text-[#5d4d42]">CALL Delta</th>
                                    <th className="border border-[#decabb] py-2 px-4 text-center font-medium whitespace-nowrap border-r-4 border-r-[#d6c2b1] text-[#5d4d42]">總Delta</th>
                                    <th className="border border-[#decabb] py-2 px-4 text-center font-medium whitespace-nowrap text-[#5d4d42]">隱含波動</th>
                                    <th className="border border-[#decabb] py-2 px-4 text-center font-medium whitespace-nowrap text-[#5d4d42]">資金效率</th>
                                    <th className="border border-[#decabb] py-2 px-4 text-center font-medium whitespace-nowrap text-[#5d4d42]">資金流水</th>
                                </tr>
                            </thead>
                            <tbody>
                                {analysis.map((month) => (
                                    <tr key={month.month} className="hover:bg-[#decabb]/20 odd:bg-[#fbf9f6] even:bg-[#f4f1ed]">
                                        <td className="border border-[#e6d8ce] py-1.5 px-4 text-center whitespace-nowrap text-[#4a4038]">{month.month}月</td>
                                        <td className="border border-[#e6d8ce] py-1.5 px-4 text-center whitespace-nowrap text-[#4a4038]">{formatPercent(month.put_win_rate)}</td>
                                        <td className="border border-[#e6d8ce] py-1.5 px-4 text-center whitespace-nowrap text-[#4a4038]">{formatPercent(month.call_win_rate)}</td>
                                        <td className="border border-[#e6d8ce] py-1.5 px-4 text-center whitespace-nowrap border-r-4 border-r-[#d6c2b1] text-[#4a4038]">{formatPercent(month.total_win_rate)}</td>
                                        <td className="border border-[#e6d8ce] py-1.5 px-4 text-center whitespace-nowrap text-[#4a4038]">{formatDecimal(month.put_delta)}</td>
                                        <td className="border border-[#e6d8ce] py-1.5 px-4 text-center whitespace-nowrap text-[#4a4038]">{formatDecimal(month.call_delta)}</td>
                                        <td className="border border-[#e6d8ce] py-1.5 px-4 text-center whitespace-nowrap border-r-4 border-r-[#d6c2b1] text-[#4a4038]">{formatDecimal(month.total_delta)}</td>
                                        <td className="border border-[#e6d8ce] py-1.5 px-4 text-center whitespace-nowrap text-[#4a4038]">{formatDecimal(month.avg_iv)}</td>
                                        <td className="border border-[#e6d8ce] py-1.5 px-4 text-center whitespace-nowrap text-[#4a4038]">{month.capital_efficiency > 0 ? `${month.capital_efficiency.toFixed(3)}%` : ''}</td>
                                        <td className="border border-[#e6d8ce] py-1.5 px-4 text-center whitespace-nowrap text-[#4a4038]">{formatNumber(month.capital_flow)}</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr className="bg-[#f0e8e0] font-bold text-[#5d4d42]">
                                    <td className="border border-[#decabb] py-1.5 px-4 text-center whitespace-nowrap">總結</td>
                                    <td className="border border-[#decabb] py-1.5 px-4 text-center whitespace-nowrap">{totals.put_win_rate_count > 0 ? formatPercent(totals.put_win_rate_sum / totals.put_win_rate_count) : ''}</td>
                                    <td className="border border-[#decabb] py-1.5 px-4 text-center whitespace-nowrap">{totals.call_win_rate_count > 0 ? formatPercent(totals.call_win_rate_sum / totals.call_win_rate_count) : ''}</td>
                                    <td className="border border-[#decabb] py-1.5 px-4 text-center whitespace-nowrap border-r-4 border-r-[#d6c2b1]">{totals.total_win_rate_count > 0 ? formatPercent(totals.total_win_rate_sum / totals.total_win_rate_count) : ''}</td>
                                    <td className="border border-[#decabb] py-1.5 px-4 text-center whitespace-nowrap">{totals.put_delta_count > 0 ? formatDecimal(totals.put_delta_sum / totals.put_delta_count) : ''}</td>
                                    <td className="border border-[#decabb] py-1.5 px-4 text-center whitespace-nowrap">{totals.call_delta_count > 0 ? formatDecimal(totals.call_delta_sum / totals.call_delta_count) : ''}</td>
                                    <td className="border border-[#decabb] py-1.5 px-4 text-center whitespace-nowrap border-r-4 border-r-[#d6c2b1]">{totals.total_delta_count > 0 ? formatDecimal(totals.total_delta_sum / totals.total_delta_count) : ''}</td>
                                    <td className="border border-[#decabb] py-1.5 px-4 text-center whitespace-nowrap">{totals.avg_iv_count > 0 ? formatDecimal(totals.avg_iv_sum / totals.avg_iv_count) : ''}</td>
                                    <td className="border border-[#decabb] py-1.5 px-4 text-center whitespace-nowrap">{totals.capital_efficiency_count > 0 ? `${(totals.capital_efficiency_sum / totals.capital_efficiency_count).toFixed(3)}%` : ''}</td>
                                    <td className="border border-[#decabb] py-1.5 px-4 text-center whitespace-nowrap">{formatNumber(totals.capital_flow_total)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
