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
        return value > 0 ? `${value.toFixed(3)}%` : '';
    };

    const formatDecimal = (value: number) => {
        return value > 0 ? value.toFixed(3) : '';
    };

    const formatNumber = (value: number) => {
        return value > 0 ? value.toLocaleString() : '';
    };

    // Calculate totals
    const totals = analysis.reduce((acc, month) => {
        // For weighted averages
        acc.put_win_rate_sum += month.put_win_rate;
        acc.call_win_rate_sum += month.call_win_rate;
        acc.total_win_rate_sum += month.total_win_rate;
        acc.put_delta_sum += month.put_delta;
        acc.call_delta_sum += month.call_delta;
        acc.total_delta_sum += month.total_delta;
        acc.avg_iv_sum += month.avg_iv;
        acc.capital_efficiency_sum += month.capital_efficiency;
        acc.capital_flow_total += month.capital_flow;

        acc.count += month.put_win_rate > 0 || month.call_win_rate > 0 || month.total_win_rate > 0 ? 1 : 0;

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
        count: 0
    });

    const displayName = user?.user_id || user?.email || '';

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="p-0 gap-0 bg-[#fbf9f6] flex flex-col"
                style={{
                    maxWidth: '85vw',
                    width: 'auto',
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
                                        <td className="border border-[#e6d8ce] py-1.5 px-4 text-center whitespace-nowrap text-[#4a4038]">{formatPercent(month.capital_efficiency)}</td>
                                        <td className="border border-[#e6d8ce] py-1.5 px-4 text-center whitespace-nowrap text-[#4a4038]">{formatNumber(month.capital_flow)}</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr className="bg-[#f0e8e0] font-bold text-[#5d4d42]">
                                    <td className="border border-[#decabb] py-1.5 px-4 text-center whitespace-nowrap">總結</td>
                                    <td className="border border-[#decabb] py-1.5 px-4 text-center whitespace-nowrap">{totals.count > 0 ? formatPercent(totals.put_win_rate_sum / 12) : ''}</td>
                                    <td className="border border-[#decabb] py-1.5 px-4 text-center whitespace-nowrap">{totals.count > 0 ? formatPercent(totals.call_win_rate_sum / 12) : ''}</td>
                                    <td className="border border-[#decabb] py-1.5 px-4 text-center whitespace-nowrap border-r-4 border-r-[#d6c2b1]">{totals.count > 0 ? formatPercent(totals.total_win_rate_sum / 12) : ''}</td>
                                    <td className="border border-[#decabb] py-1.5 px-4 text-center whitespace-nowrap">{totals.count > 0 ? formatDecimal(totals.put_delta_sum / 12) : ''}</td>
                                    <td className="border border-[#decabb] py-1.5 px-4 text-center whitespace-nowrap">{totals.count > 0 ? formatDecimal(totals.call_delta_sum / 12) : ''}</td>
                                    <td className="border border-[#decabb] py-1.5 px-4 text-center whitespace-nowrap border-r-4 border-r-[#d6c2b1]">{totals.count > 0 ? formatDecimal(totals.total_delta_sum / 12) : ''}</td>
                                    <td className="border border-[#decabb] py-1.5 px-4 text-center whitespace-nowrap">{totals.count > 0 ? formatDecimal(totals.avg_iv_sum / 12) : ''}</td>
                                    <td className="border border-[#decabb] py-1.5 px-4 text-center whitespace-nowrap">{totals.count > 0 ? formatPercent(totals.capital_efficiency_sum / 12) : ''}</td>
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
