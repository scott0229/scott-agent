import React from 'react';
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { Pencil, ArrowRightLeft } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StockTrade {
    id: number;
    user_id: string;
    owner_id: number;
    year: number;
    symbol: string;
    status: 'Open' | 'Closed';
    open_date: number;
    close_date?: number | null;
    open_price: number;
    close_price?: number | null;
    quantity: number;
    code?: string;
    source?: string;
    close_source?: string;
    current_market_price?: number | null;
    include_in_options?: number;
    note?: string | null;
    note_color?: string | null;
    group_id?: string | number | null;
}

export interface User {
    id: number;
    user_id: string;
    email: string;
    role: string;
}

interface StockTradesTableProps {
    sortedTrades: StockTrade[];
    runningDataMap: Record<number, { total: number; avgPrice: number | null }>;
    settings: any;
    currentUser: User | null;
    onColorToggle?: (id: number, currentColor: string | null | undefined) => void;
    onNoteUpdate?: (id: number, note: string) => void;
    onGroupUpdate?: (id: number, newGroupId: string | null) => void;
    onToggleIncludeInOptions?: (trade: StockTrade) => void;
    onUserClick?: (userId: string) => void;
    onSymbolClick?: (symbol: string) => void;
    onTransferClick?: (trade: StockTrade) => void;
    onEditClick?: (trade: StockTrade) => void;
    formatMoney: (val: number | null | undefined) => string | '-';
    formatPnL: (val: number | null | undefined) => string | '-';
    formatDate: (ts: number) => string;
    hideOwnerColumn?: boolean;
}

export function StockTradesTable({
    sortedTrades,
    runningDataMap,
    settings,
    currentUser,
    onColorToggle,
    onNoteUpdate,
    onGroupUpdate,
    onToggleIncludeInOptions,
    onUserClick,
    onSymbolClick,
    onTransferClick,
    onEditClick,
    formatMoney,
    formatPnL,
    formatDate,
    hideOwnerColumn
}: StockTradesTableProps) {

    const canEdit = (trade: StockTrade) => {
        if (!currentUser) return false;
        if (currentUser.role === 'admin' || currentUser.role === 'manager') return true;
        return currentUser.user_id === trade.user_id;
    };

    return (
        <TooltipProvider delayDuration={300}>
            <div className="bg-white rounded-lg shadow-sm border overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-secondary hover:bg-secondary">
                            <TableHead className="w-[50px] text-center"></TableHead>
                            <TableHead className="text-left"></TableHead>
                            <TableHead className="text-center w-[95px]"></TableHead>
                            {!hideOwnerColumn && <TableHead className="text-center">持有者</TableHead>}
                            <TableHead className="text-center">開倉日</TableHead>
                            <TableHead className="text-center">平倉日</TableHead>
                            <TableHead className="text-center">標的</TableHead>
                            <TableHead className="text-center">股數</TableHead>
                            <TableHead className="text-center">開倉價</TableHead>
                            <TableHead className="text-center">平倉價</TableHead>
                            <TableHead className="text-center">當前股價</TableHead>
                            <TableHead className="text-center">盈虧</TableHead>
                            <TableHead className="text-center">當日總倉位</TableHead>
                            <TableHead className="text-center">盈虧列入期權</TableHead>
                            {settings?.showTradeCode && <TableHead className="text-center">交易代碼</TableHead>}
                            <TableHead className="text-right"></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {sortedTrades.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={13} className="h-24 text-center">
                                    無交易紀錄
                                </TableCell>
                            </TableRow>
                        ) : (
                            sortedTrades.map((trade, index) => {
                                const isClosed = trade.status === 'Closed';
                                let pnl: number | null = null;
                                if (isClosed && trade.close_price) {
                                    pnl = Math.round((trade.close_price - trade.open_price) * trade.quantity * 100) / 100;
                                } else if (!isClosed && trade.current_market_price) {
                                    pnl = Math.round((trade.current_market_price - trade.open_price) * trade.quantity * 100) / 100;
                                }

                                return (
                                    <TableRow key={trade.id} className="h-[40px]">
                                        <TableCell className="text-center text-muted-foreground font-mono py-1">
                                            <div className="flex items-center justify-center gap-4">
                                                <span>{sortedTrades.length - index}</span>
                                                {trade.note?.trim() ? (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            onColorToggle && onColorToggle(trade.id, trade.note_color);
                                                        }}
                                                        className={`w-4 h-4 rounded-full shrink-0 shadow-sm transition-colors opacity-90 hover:opacity-100 ${
                                                            trade.note_color === 'red' ? 'bg-red-500' : trade.note_color === 'green' ? 'bg-green-600' : 'bg-blue-500'
                                                        }`}
                                                        title="切換註解顏色"
                                                    />
                                                ) : (
                                                    <div className="w-4 h-4 shrink-0" />
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell className="py-1 min-w-[180px]">
                                            <input 
                                                className="w-full bg-transparent focus:outline-none px-1 text-left text-[13px] font-medium"
                                                style={{ color: trade.note_color === 'red' ? '#7f1d1d' : trade.note_color === 'green' ? '#15803d' : '#1e3a8a' }}
                                                maxLength={50}
                                                defaultValue={trade.note || ''}
                                                placeholder="..."
                                                onBlur={(e) => {
                                                    if (e.target.value !== (trade.note || '')) {
                                                        onNoteUpdate && onNoteUpdate(trade.id, e.target.value);
                                                    }
                                                }}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        e.currentTarget.blur();
                                                    }
                                                }}
                                            />
                                        </TableCell>
                                        <TableCell className="py-1 min-w-[95px]">
                                            {trade.include_in_options === 1 && (
                                                <Select 
                                                    value={trade.group_id ? String(trade.group_id) : "none"} 
                                                    onValueChange={(val) => onGroupUpdate && onGroupUpdate(trade.id, val === "none" ? null : val)}
                                                >
                                                    <SelectTrigger hideIcon className={`w-[80px] mx-auto h-7 px-1 py-0 border-none focus:ring-0 shadow-none text-center justify-center font-normal ${
                                                        trade.group_id && String(trade.group_id).endsWith('-0') 
                                                            ? 'bg-yellow-100 hover:bg-yellow-200' 
                                                            : trade.group_id && String(trade.group_id).endsWith('-2')
                                                                ? 'bg-green-100 hover:bg-green-200'
                                                                : 'bg-slate-100 hover:bg-slate-200'
                                                    }`}>
                                                        <SelectValue placeholder="-" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="none" className="text-muted-foreground">-</SelectItem>
                                                        {[
                                                            'QQQ-0', 'QQQ-1', 'QQQ-2', 'QQQ-3', 'QQQ-4', 'QQQ-5',
                                                            'TQQQ-0', 'TQQQ-1', 'TQQQ-2', 'TQQQ-3', 'TQQQ-4', 'TQQQ-5',
                                                            'GROUP-0', 'GROUP-1', 'GROUP-2', 'GROUP-3', 'GROUP-4', 'GROUP-5'
                                                        ].map(n => (
                                                            <SelectItem key={n} value={n}>{n}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            )}
                                        </TableCell>
                                        {!hideOwnerColumn && (
                                            <TableCell className="text-center py-1">
                                                <span
                                                    className={`transition-all duration-150 ${onUserClick ? 'cursor-pointer hover:text-primary hover:underline hover:font-semibold' : ''}`}
                                                    onClick={() => onUserClick && onUserClick(trade.user_id || '')}
                                                    title={onUserClick ? `點擊過濾 ${trade.user_id} 的交易` : undefined}
                                                >
                                                    {trade.user_id || '-'}
                                                </span>
                                            </TableCell>
                                        )}
                                        <TableCell className="text-center py-1">
                                            {formatDate(trade.open_date)}
                                            {trade.source === 'assigned' && <span className="text-xs text-green-700 font-medium ml-1">(被指派)</span>}
                                        </TableCell>
                                        <TableCell className={cn("text-center py-1", !trade.close_date && "bg-pink-50")}>
                                            {trade.close_date ? formatDate(trade.close_date) : 'Open'}
                                            {trade.close_source === 'assigned' && <span className="text-xs text-green-700 font-medium ml-1">(被指派)</span>}
                                            {trade.close_source === 'transfer' && <span className="text-xs text-gray-500 font-medium ml-1">(Transferred)</span>}
                                        </TableCell>
                                        <TableCell className="text-center py-1">
                                            <span
                                                className={`transition-all duration-150 ${onSymbolClick ? 'cursor-pointer hover:text-primary hover:underline hover:font-semibold' : ''}`}
                                                onClick={() => onSymbolClick && onSymbolClick(trade.symbol)}
                                                title={onSymbolClick ? `點擊過濾 ${trade.symbol} 的交易` : undefined}
                                            >
                                                {trade.symbol}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-center py-1">{trade.quantity.toLocaleString()}</TableCell>
                                        <TableCell className="text-center py-1">{formatMoney(trade.open_price)}</TableCell>
                                        <TableCell className="text-center py-1">
                                            {trade.close_price ? formatMoney(trade.close_price) : '-'}
                                        </TableCell>
                                        <TableCell className="text-center py-1">
                                            {isClosed ? '-' : (trade.current_market_price ? formatMoney(trade.current_market_price) : '-')}
                                        </TableCell>
                                        <TableCell className={cn("text-center py-1", pnl !== null && pnl < 0 && 'bg-pink-50')}>
                                            {pnl !== null ? formatPnL(pnl) : '-'}
                                        </TableCell>
                                        <TableCell className="text-center py-1 whitespace-nowrap">
                                            {runningDataMap[trade.id]?.total > 0 
                                                ? (
                                                    <div className="flex items-center justify-center gap-1">
                                                        <span className="text-[13px] text-foreground">{runningDataMap[trade.id].total.toLocaleString()},</span>
                                                        <span className="text-[13px] text-foreground underline underline-offset-2">均{formatMoney(runningDataMap[trade.id].avgPrice)}</span>
                                                    </div>
                                                )
                                                : '-'}
                                        </TableCell>
                                        <TableCell className="text-center py-1">
                                            <button
                                                onClick={() => onToggleIncludeInOptions && onToggleIncludeInOptions(trade)}
                                                className={cn(
                                                    "inline-flex items-center justify-center w-6 h-6 rounded-full border transition-all duration-200 cursor-pointer",
                                                    trade.include_in_options === 1
                                                        ? "bg-green-100 border-green-400 text-green-700 hover:bg-green-200"
                                                        : trade.include_in_options === 2
                                                            ? "bg-red-100 border-red-400 text-red-700 hover:bg-red-200"
                                                            : "bg-gray-50 border-gray-300 text-gray-400 hover:bg-gray-100 hover:text-gray-500"
                                                )}
                                                disabled={!onToggleIncludeInOptions}
                                            >
                                                {trade.include_in_options === 1 ? '✓' : trade.include_in_options === 2 ? '✕' : ''}
                                            </button>
                                        </TableCell>
                                        {settings?.showTradeCode && (
                                            <TableCell className="text-center font-mono text-sm py-1">
                                                {trade.code || '-'}
                                            </TableCell>
                                        )}
                                        <TableCell className="py-1">
                                            <div className="flex justify-end gap-1">
                                                {canEdit(trade) && (
                                                    <>
                                                        {!isClosed && onTransferClick && (
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        onClick={() => onTransferClick(trade)}
                                                                        className="text-muted-foreground hover:text-orange-500 hover:bg-orange-50"
                                                                    >
                                                                        <ArrowRightLeft className="h-4 w-4" />
                                                                    </Button>
                                                                </TooltipTrigger>
                                                                <TooltipContent>
                                                                    <p>手動轉倉 (平倉)</p>
                                                                </TooltipContent>
                                                            </Tooltip>
                                                        )}
                                                        {onEditClick && (
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        onClick={() => onEditClick(trade)}
                                                                        className="text-muted-foreground hover:text-primary hover:bg-primary/10"
                                                                    >
                                                                        <Pencil className="h-4 w-4" />
                                                                    </Button>
                                                                </TooltipTrigger>
                                                                <TooltipContent>
                                                                    <p>編輯</p>
                                                                </TooltipContent>
                                                            </Tooltip>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                );
                            })
                        )}
                    </TableBody>
                </Table>
            </div>
        </TooltipProvider>
    );
}
